import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import {
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
} from '@solana/kit';
import { DbService } from '../db/db.service';
import { paymentAttempts } from '../db/schema';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import { PaymentIntentService } from '../payment/payment-intent.service';
import { SpendService } from '../account/spend.service';
import { SettlementProvisioningService } from './settlement-provisioning.service';
import { SettlementConfirmationService } from './settlement-confirmation.service';
import {
  AttemptAlreadyLiveError,
  IntentNotSettleableError,
  SettlementMessageMismatchError,
} from './settlement.errors';

const USDC_DECIMALS = 6;

/** A settlement Spend that has been built but not yet recorded anywhere. */
export interface BuiltSettlement {
  unsignedTxBase64: string;
  messageBase64: string;
  blockhash: string;
  expectedSettlementAccount: string;
  /** The Account signer the popup has to sign with. */
  signerAddress: string;
  /**
   * True when the Spend is above the band one signature carries, so it also
   * needs the approval signer. Checkout cannot reach that signer, and has to
   * say so rather than hand back a transaction the cluster will reject.
   */
  needsApprovalSignature: boolean;
}

/**
 * Builds and submits the settlement transaction.
 *
 * ## Where the money comes from
 *
 * The Consumer's vault, through the Account's own policies, which is the same
 * path a Send takes. It used to be a plain SPL transfer out of the Privy
 * wallet, and that stopped being where anybody's money was the moment the
 * Account became a Squads smart account. A Payment is a Spend, so it resolves
 * its route through {@link SpendService} rather than building its own transfer.
 *
 * ## Why the relayer is no longer the fee payer
 *
 * Its co-sign allowlist admits ComputeBudget, Token and ATA and nothing else,
 * which is deliberate and is what makes it safe to expose. A Spend carries a
 * Squads instruction, so the relayer cannot co-sign one without widening the
 * surface that narrowness buys. The settlement authority pays instead, as it
 * already does for a Send.
 *
 * What replaces the relayer's validation is the pinned message: the build
 * records the compiled message on the attempt, and submit refuses anything
 * whose bytes differ. The authority therefore only ever signs a transaction
 * this service built. The one-live-attempt index plus signature-first retry
 * remains the durable double-settlement guard.
 */
@Injectable()
export class SettlementService implements OnModuleInit {
  private readonly logger = new Logger(SettlementService.name);
  private usdcMint!: string;

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    private readonly intents: PaymentIntentService,
    private readonly provisioning: SettlementProvisioningService,
    private readonly spends: SpendService,
    private readonly confirmation: SettlementConfirmationService,
  ) {}

  onModuleInit(): void {
    this.usdcMint = this.config.getOrThrow<string>(
      'EXPO_PUBLIC_USDC_MINT_ADDRESS',
    );
  }

  /**
   * Builds the Spend that settles a Payment, and changes nothing.
   *
   * Deliberately side-effect free and deliberately not gated on the intent
   * already being authorized: the caller has to know whether the Account can
   * carry this Payment on one signature *before* it spends capacity or issues a
   * Session on it. A Payment that needs the phone is refused with the intent
   * still untouched, so the Consumer can finish it from the app.
   *
   * {@link pinSettlement} records the result once an attempt exists.
   */
  async buildSettlement(
    intentId: string,
    consumerId: string,
  ): Promise<BuiltSettlement> {
    const intent = await this.intents.findById(intentId);
    if (intent.status !== 'created' && intent.status !== 'authorized') {
      throw new IntentNotSettleableError(
        `intent ${intentId} is ${intent.status}, not settleable`,
      );
    }

    const endpoint = await this.provisioning.getSettlementAddressForSettlement(
      intent.merchantId,
    );

    const spend = await this.spends.prepare({
      userId: consumerId,
      destination: endpoint.owner,
      destinationTokenAccount: endpoint.address,
      mint: this.usdcMint,
      amountRaw: intent.usdcSettlementRaw,
      decimals: USDC_DECIMALS,
    });

    this.logger.log(
      `settlement.build intent_id=${intentId} route=${spend.route}` +
        ` vault=${spend.vaultAddress}`,
    );

    return {
      unsignedTxBase64: spend.unsignedTxBase64,
      messageBase64: spend.messageBase64,
      blockhash: spend.blockhash,
      expectedSettlementAccount: endpoint.address,
      signerAddress: spend.primarySigner,
      needsApprovalSignature: spend.needsApprovalSignature,
    };
  }

  /**
   * Pins the built message on the live authorized attempt, which is what makes
   * it safe for the authority to complete later: submit refuses any bytes that
   * do not match, so the authority only ever signs what this service built.
   */
  async pinSettlement(
    intentId: string,
    built: BuiltSettlement,
  ): Promise<{ attemptId: string }> {
    const attempt = await this.loadLiveAttempt(intentId, ['authorized']);
    if (!attempt) {
      throw new IntentNotSettleableError(
        `intent ${intentId} has no live authorized attempt`,
      );
    }

    const pinned = await this.db.client
      .update(paymentAttempts)
      .set({
        messageBase64: built.messageBase64,
        blockhash: built.blockhash,
        updatedAt: new Date(),
      })
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

    return { attemptId: attempt.id };
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

    // The fee payer's signature, added last. What the Consumer signed is a
    // Spend one signature short, and the byte check above is what makes it safe
    // for the authority to complete: it only ever signs the message this
    // service built and pinned.
    const signature = await this.spends.submit(consumerSignedTxBase64);

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

    // Kick off the active confirmation poll detached from the submit
    // response path (the hot path races the Helius webhook; the 30s sweep is
    // the tail). Failures are logged, never surfaced to the caller here.
    void this.confirmation
      .awaitConfirmation(intentId, signature)
      .catch((err) =>
        this.logger.error(
          `settlement.confirm.detached_failed intent_id=${intentId} signature=${signature}`,
          err,
        ),
      );

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
}
