import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import {
  address,
  appendTransactionMessageInstructions,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase64Decoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { DbService } from '../db/db.service';
import { paymentAttempts, smartAccounts } from '../db/schema';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import { PaymentIntentService } from '../payment/payment-intent.service';
import { SettlementProvisioningService } from './settlement-provisioning.service';
import { RelayerClient } from './relayer.client';
import {
  AttemptAlreadyLiveError,
  IntentNotSettleableError,
  SettlementMessageMismatchError,
} from './settlement.errors';

/** A conservative compute-unit limit, comfortably under the relayer ceiling. */
const SETTLEMENT_CU_LIMIT = 60_000;
const USDC_DECIMALS = 6;

/**
 * Builds and submits the settlement transaction. The build compiles a v0
 * transaction (fee payer = the relayer, ComputeBudget + a single plain SPL
 * USDC TransferChecked into the endpoint token account read from the
 * provisioned row, fresh blockhash at approval time) and pins its compiled
 * message on the authorized attempt. The Consumer signs off-band. The submit
 * byte-checks the signed message against the pinned message and relays the
 * bytes to the Phase 3 /internal/cosign seam, which validates + co-signs +
 * broadcasts. The one-live-attempt index (Phase 2) plus signature-first
 * retry is the durable double-settlement guard the relayer does not provide.
 */
@Injectable()
export class SettlementService implements OnModuleInit {
  private readonly logger = new Logger(SettlementService.name);
  private usdcMint!: string;
  private relayerFeePayer!: string;

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    private readonly intents: PaymentIntentService,
    private readonly provisioning: SettlementProvisioningService,
    private readonly relayer: RelayerClient,
  ) {}

  onModuleInit(): void {
    this.usdcMint = this.config.getOrThrow<string>(
      'EXPO_PUBLIC_USDC_MINT_ADDRESS',
    );
    this.relayerFeePayer = this.config.getOrThrow<string>(
      'RELAYER_FEE_PAYER_ADDRESS',
    );
  }

  async buildSettlement(intentId: string): Promise<{
    attemptId: string;
    unsignedTxBase64: string;
    messageBase64: string;
    expectedSettlementAccount: string;
  }> {
    const intent = await this.intents.findById(intentId);
    if (intent.status !== 'authorized') {
      throw new IntentNotSettleableError(
        `intent ${intentId} is ${intent.status}, not authorized`,
      );
    }
    const attempt = await this.loadLiveAttempt(intentId, ['authorized']);
    if (!attempt) {
      throw new IntentNotSettleableError(
        `intent ${intentId} has no live authorized attempt`,
      );
    }
    if (!intent.consumerId) {
      throw new IntentNotSettleableError(`intent ${intentId} has no consumer`);
    }

    const { address: expectedSettlementAccount } =
      await this.provisioning.getSettlementAddressForSettlement(
        intent.merchantId,
      );
    const consumerWallet = await this.consumerWallet(intent.consumerId);

    const usdcMint = address(this.usdcMint);
    const [consumerAta] = await findAssociatedTokenPda({
      owner: address(consumerWallet),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      mint: usdcMint,
    });

    // Fresh blockhash at approval time (never reuse an earlier one).
    const { blockhash, lastValidBlockHeight } =
      await this.solana.getRecentBlockhash();
    const { computeUnitPrice } = await this.relayer.getPriorityFee(intentId);

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(address(this.relayerFeePayer), m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash as Blockhash,
            lastValidBlockHeight: BigInt(lastValidBlockHeight),
          },
          m,
        ),
      (m) =>
        appendTransactionMessageInstructions(
          [
            getSetComputeUnitLimitInstruction({ units: SETTLEMENT_CU_LIMIT }),
            getSetComputeUnitPriceInstruction({
              microLamports: computeUnitPrice,
            }),
            // A plain SPL TransferChecked into a classic-SPL token account
            // (REQ-PLAIN-SPL): no provider-program instruction on the hot
            // path, so the Phase 3 relayer allowlist stays valid.
            getTransferCheckedInstruction({
              source: consumerAta,
              mint: usdcMint,
              destination: address(expectedSettlementAccount),
              authority: address(consumerWallet),
              amount: BigInt(intent.usdcSettlementRaw),
              decimals: USDC_DECIMALS,
            }),
          ],
          m,
        ),
    );
    const compiled = compileTransaction(message);
    const unsignedTxBase64 = getBase64EncodedWireTransaction(compiled);
    const messageBase64 = getBase64Decoder().decode(compiled.messageBytes);

    // Pin the compiled message + blockhash on the authorized attempt. No
    // broadcast, no transition to settling yet.
    const pinned = await this.db.client
      .update(paymentAttempts)
      .set({ messageBase64, blockhash, updatedAt: new Date() })
      .where(
        and(
          eq(paymentAttempts.id, attempt.id),
          eq(paymentAttempts.status, 'authorized'),
        ),
      )
      .returning({ id: paymentAttempts.id });
    if (pinned.length === 0) {
      throw new AttemptAlreadyLiveError(
        `attempt ${attempt.id} is no longer authorized`,
      );
    }

    return {
      attemptId: attempt.id,
      unsignedTxBase64,
      messageBase64,
      expectedSettlementAccount,
    };
  }

  async submitSettlement(
    intentId: string,
    consumerSignedTxBase64: string,
  ): Promise<{ attemptId: string; signature: string; status: 'settling' }> {
    const intent = await this.intents.findById(intentId);
    const attempt = await this.loadLiveAttempt(intentId, [
      'authorized',
      'settling',
    ]);
    if (!attempt) {
      throw new IntentNotSettleableError(
        `intent ${intentId} has no live attempt`,
      );
    }

    // Signature-first retry: an already-live settling attempt with a
    // recorded signature is resolved, never re-cosigned or rebuilt.
    if (attempt.status === 'settling' && attempt.txSignature) {
      await this.resolveInFlight(intentId);
      return {
        attemptId: attempt.id,
        signature: attempt.txSignature,
        status: 'settling',
      };
    }

    // Byte-equality: the signed tx's compiled message must equal the pinned
    // message, so the broadcast tx cannot diverge from what was recorded.
    const decoded = getTransactionDecoder().decode(
      getBase64Encoder().encode(consumerSignedTxBase64),
    );
    const submittedMessageBase64 = getBase64Decoder().decode(
      decoded.messageBytes,
    );
    if (submittedMessageBase64 !== attempt.messageBase64) {
      throw new SettlementMessageMismatchError(
        `submitted message does not match the pinned message for intent ${intentId}`,
      );
    }

    if (!intent.consumerId) {
      throw new IntentNotSettleableError(`intent ${intentId} has no consumer`);
    }
    const { address: expectedSettlementAccount } =
      await this.provisioning.getSettlementAddressForSettlement(
        intent.merchantId,
      );

    const { signature } = await this.relayer.cosign(
      {
        intentId,
        consumerId: intent.consumerId,
        merchantId: intent.merchantId,
        transactionBase64: consumerSignedTxBase64,
        expectedSettlementAccount,
        expectedMessageBase64: attempt.messageBase64 ?? undefined,
      },
      intentId,
    );

    // Record the signature and move the attempt live, then transition the
    // intent. Keep these two writes adjacent with nothing awaited between
    // them; the window is what the stuck-authorized reaper (task 4.4)
    // recovers from.
    const moved = await this.db.client
      .update(paymentAttempts)
      .set({
        txSignature: signature,
        status: 'settling',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentAttempts.id, attempt.id),
          eq(paymentAttempts.status, 'authorized'),
        ),
      )
      .returning({ id: paymentAttempts.id });
    if (moved.length === 0) {
      throw new AttemptAlreadyLiveError(
        `attempt ${attempt.id} is no longer authorized`,
      );
    }
    await this.intents.transition(intentId, 'authorized', 'settling', {});

    this.logger.log(
      `settlement.submit intent_id=${intentId} attempt_id=${attempt.id} signature=${signature}`,
    );
    return { attemptId: attempt.id, signature, status: 'settling' };
  }

  /**
   * Signature-first retry: resolve a live attempt's recorded signature
   * instead of rebuilding. This never builds a new transaction; a brand-new
   * attempt is only created by re-running Phase 2 authorize AFTER the sweep
   * force-fails the dead attempt, which is the whole double-settlement guard.
   */
  async resolveInFlight(
    intentId: string,
  ): Promise<'succeeded' | 'failed' | 'still_settling'> {
    const attempt = await this.loadLiveAttempt(intentId, [
      'authorized',
      'settling',
    ]);
    if (!attempt?.txSignature) {
      return 'still_settling';
    }
    const [status] = await this.solana.getSignatureStatuses([
      attempt.txSignature,
    ]);
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return 'succeeded';
    }
    if (status?.err) {
      return 'failed';
    }
    return 'still_settling';
  }

  private async loadLiveAttempt(
    intentId: string,
    statuses: ('authorized' | 'settling')[],
  ) {
    const [attempt] = await this.db.client
      .select()
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.intentId, intentId),
          inArray(paymentAttempts.status, statuses),
        ),
      )
      .limit(1);
    return attempt;
  }

  private async consumerWallet(consumerId: string): Promise<string> {
    const [acct] = await this.db.client
      .select({ walletAddress: smartAccounts.walletAddress })
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, consumerId))
      .limit(1);
    if (!acct?.walletAddress) {
      throw new IntentNotSettleableError(
        `consumer ${consumerId} has no smart account wallet`,
      );
    }
    return acct.walletAddress;
  }
}
