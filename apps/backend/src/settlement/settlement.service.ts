import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createPublicKey, verify } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
} from '@solana/kit';
import { DbService } from '../db/db.service';
import { paymentAttempts } from '../db/schema';
import { CapacityService } from '../capability/capacity.service';
import { EVENT_PUBLISHER } from '../events/event-publisher.interface';
import type { EventPublisher } from '../events/event-publisher.interface';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import { PaymentIntentService } from '../payment/payment-intent.service';
import { IntentExpiredError } from '../payment/payment.errors';
import { SpendService } from '../account/spend.service';
import { SettlementProvisioningService } from './settlement-provisioning.service';
import { SettlementConfirmationService } from './settlement-confirmation.service';
import {
  AttemptAlreadyLiveError,
  FiatSettlementDisabledError,
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
    private readonly capacity: CapacityService,
    private readonly intents: PaymentIntentService,
    private readonly provisioning: SettlementProvisioningService,
    private readonly spends: SpendService,
    private readonly confirmation: SettlementConfirmationService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
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
    this.assertExecutionCluster(intent.executionCluster);
    if (intent.status !== 'created' && intent.status !== 'authorized') {
      throw new IntentNotSettleableError(
        `intent ${intentId} is ${intent.status}, not settleable`,
      );
    }
    if (intent.expiresAt.getTime() <= Date.now()) {
      throw new IntentExpiredError(
        `intent ${intentId} expired; request a new quote`,
      );
    }

    const endpoint = await this.provisioning.getSettlementAddressForSettlement(
      intent.merchantId,
    );
    if (endpoint.provider !== 'direct_usdc') {
      throw new FiatSettlementDisabledError();
    }

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

  /** Terminal retries must prove possession of the Consumer's signed Spend.
   * References and arbitrary bytes cannot mint a signed Merchant redirect.
   * Verify the pinned message and every non-fee-payer signer without rebroadcast.
   */
  async verifySettlementProof(
    intentId: string,
    signedTxBase64: string,
  ): Promise<void> {
    const [attempt] = await this.db.client
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.intentId, intentId))
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(1);
    try {
      const tx = VersionedTransaction.deserialize(
        Buffer.from(signedTxBase64, 'base64'),
      );
      const message = tx.message.serialize();
      const count = tx.message.header.numRequiredSignatures;
      if (
        !attempt?.messageBase64 ||
        Buffer.from(message).toString('base64') !== attempt.messageBase64 ||
        count < 2
      )
        throw new Error('No matching signed Spend');
      for (let index = 1; index < count; index++) {
        const key = createPublicKey({
          key: Buffer.concat([
            Buffer.from('302a300506032b6570032100', 'hex'),
            tx.message.staticAccountKeys[index].toBuffer(),
          ]),
          format: 'der',
          type: 'spki',
        });
        if (!verify(null, message, key, tx.signatures[index]))
          throw new Error('Invalid Consumer signature');
      }
    } catch {
      throw new SettlementMessageMismatchError(
        'A valid Consumer-signed Payment is required',
      );
    }
  }

  async submitSettlement(
    intentId: string,
    consumerSignedTxBase64: string,
  ): Promise<{ attemptId: string; signature: string; status: 'settling' }> {
    // Cross-process serialization, before reading the attempt or signing.
    // A concurrent retry observes the first caller's recorded signature and
    // reconciles it instead of racing another authority-sign/broadcast call.
    return this.db.withAdvisoryLock(`payment-submit:${intentId}`, () =>
      this.submitSettlementLocked(intentId, consumerSignedTxBase64),
    );
  }

  private async submitSettlementLocked(
    intentId: string,
    consumerSignedTxBase64: string,
  ): Promise<{ attemptId: string; signature: string; status: 'settling' }> {
    const intent = await this.intents.findById(intentId);
    this.assertExecutionCluster(intent.executionCluster);
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
      await this.verifySettlementProof(intentId, consumerSignedTxBase64);
      await this.resolveInFlight(intentId);
      return {
        attemptId: attempt.id,
        signature: attempt.txSignature,
        status: 'settling',
      };
    }

    // An already-broadcast retry above is reconciled even after expiry. A new
    // broadcast must still be covered by the price the Consumer approved.
    if (intent.expiresAt.getTime() <= Date.now()) {
      await this.expireAuthorizedBeforeBroadcast(intent, attempt.id);
      throw new IntentExpiredError(
        `intent ${intentId} expired; request a new quote`,
      );
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
    // Recheck at submission, including transactions prepared before the pilot
    // gate shipped. Already-broadcast attempts above still reconcile normally.
    const endpoint = await this.provisioning.getSettlementAddressForSettlement(
      intent.merchantId,
    );
    if (endpoint.provider !== 'direct_usdc') {
      throw new FiatSettlementDisabledError();
    }
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
    const intent = await this.intents.findById(intentId);
    this.assertExecutionCluster(intent.executionCluster);
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
    if (status?.err) {
      return 'failed';
    }
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return 'succeeded';
    }
    return 'still_settling';
  }

  /**
   * A pinned Spend that expires before submission is known not to have moved
   * money: the authority has neither signed nor broadcast it. Retire the
   * attempt, intent and capacity reservation in one transaction so the
   * orphan-suspected reaper never has to guess about this deterministic case.
   */
  private async expireAuthorizedBeforeBroadcast(
    intent: Awaited<ReturnType<PaymentIntentService['findById']>>,
    attemptId: string,
  ): Promise<void> {
    if (!intent.consumerId) {
      throw new IntentNotSettleableError(
        `intent ${intent.id} has no Consumer capacity to release`,
      );
    }
    const consumerId = intent.consumerId;
    await this.db.withTransaction(async () => {
      const retired = await this.db.client
        .update(paymentAttempts)
        .set({
          status: 'failed',
          failureReason: JSON.stringify({
            code: 'QUOTE_EXPIRED_PRE_BROADCAST',
          }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(paymentAttempts.id, attemptId),
            eq(paymentAttempts.status, 'authorized'),
            isNull(paymentAttempts.txSignature),
          ),
        )
        .returning({ id: paymentAttempts.id });
      if (retired.length === 0) {
        throw new AttemptAlreadyLiveError(
          `attempt ${attemptId} is no longer awaiting broadcast`,
        );
      }
      await this.intents.transition(intent.id, 'authorized', 'expired', {});
      await this.capacity.releaseCapacity(
        consumerId,
        intent.usdcSettlementRaw,
        intent.authorizedAt ?? intent.updatedAt,
      );
    });
    await this.events.publish({
      topic: 'payment.expired',
      key: intent.id,
      payload: { intentId: intent.id },
      correlationId: intent.id,
    });
  }

  private assertExecutionCluster(cluster: string | null): void {
    if (
      !cluster ||
      cluster !== this.config.getOrThrow<string>('SOLANA_CLUSTER')
    ) {
      throw new IntentNotSettleableError(
        'Payment network is missing or does not match this deployment',
      );
    }
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
