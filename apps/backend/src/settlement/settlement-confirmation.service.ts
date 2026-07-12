import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { paymentAttempts, payments, transfers } from '../db/schema';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import { PaymentIntentService } from '../payment/payment-intent.service';
import { IntentStateConflictError } from '../payment/payment.errors';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../events/event-publisher.interface';
import { SettlementProvisioningService } from './settlement-provisioning.service';
import { SettlementRouter } from './settlement-router';
import type { SettlementCompletion } from './settlement-provider.interface';

type FailureReason = string | { code: string; [key: string]: unknown };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives the confirmation hot path (an active getSignatureStatuses poll at
 * 'confirmed' racing the Helius webhook) and finalizes the payment lifecycle
 * off the provider's completion signal. payment.succeeded publishes only on
 * completion, never on submission, with correlationId = the intent id.
 *
 * MONEY-SAFETY: finalizeSucceeded claims the settling->succeeded attempt row
 * FIRST (rowCount-guarded) so only the winner of the poll/webhook/cron race
 * calls the provider; a real convert-payout side effect
 * (handleIncomingSettlement, also contractually idempotent per signature)
 * can never fire twice.
 */
@Injectable()
export class SettlementConfirmationService implements OnModuleInit {
  private readonly logger = new Logger(SettlementConfirmationService.name);
  private pollIntervalMs!: number;
  private budgetMs!: number;

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    private readonly intents: PaymentIntentService,
    private readonly provisioning: SettlementProvisioningService,
    private readonly router: SettlementRouter,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  onModuleInit(): void {
    this.pollIntervalMs = this.config.getOrThrow<number>(
      'SETTLEMENT_CONFIRM_POLL_INTERVAL_MS',
    );
    this.budgetMs = this.config.getOrThrow<number>(
      'SETTLEMENT_CONFIRM_BUDGET_MS',
    );
  }

  /**
   * Hot path (called detached by submitSettlement): tight-poll the signature
   * at 'confirmed' up to the budget, racing the Helius webhook. On a verdict
   * finalize; on budget exhaustion return quietly and let the 30s sweep
   * finish (only blockhash expiry force-fails, never a budget timeout).
   */
  async awaitConfirmation(intentId: string, signature: string): Promise<void> {
    const deadline = Date.now() + this.budgetMs;
    while (Date.now() < deadline) {
      const [status] = await this.solana.getSignatureStatuses([signature]);
      if (
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      ) {
        await this.finalizeSucceeded(intentId, signature);
        return;
      }
      if (status?.err) {
        await this.finalizeFailed(intentId, signature, {
          code: 'CHAIN_ERROR',
          err: status.err,
        });
        return;
      }
      await sleep(this.pollIntervalMs);
    }
  }

  /**
   * Idempotent finalize on USDC confirmation. The ordering is deliberate:
   * the attempt claim gates the provider call so a convert-payout cannot fire
   * twice on the poll/webhook/cron race.
   */
  async finalizeSucceeded(intentId: string, signature: string): Promise<void> {
    // (a) CLAIM FIRST. If another signal already claimed this signature,
    // return immediately WITHOUT resolving or calling the provider.
    const claimed = await this.db.client
      .update(paymentAttempts)
      .set({ status: 'succeeded', updatedAt: new Date() })
      .where(
        and(
          eq(paymentAttempts.txSignature, signature),
          eq(paymentAttempts.status, 'settling'),
        ),
      )
      .returning({ intentId: paymentAttempts.intentId });
    if (claimed.length === 0) {
      return;
    }

    // (b) resolve the intent + its endpoint provider/address.
    const intent = await this.intents.findById(intentId);
    const consumerId = intent.consumerId;
    if (!consumerId) {
      this.logger.error(
        `settlement.confirm intent_id=${intentId} outcome=error reason=no_consumer`,
      );
      return;
    }
    const { address, provider } =
      await this.provisioning.getSettlementAddressForSettlement(
        intent.merchantId,
      );

    // (c) provider completion signal (reached at most once per signature).
    const completion = await this.router
      .forProvider(provider)
      .handleIncomingSettlement({
        endpointAddress: address,
        signature,
        amountRaw: intent.usdcSettlementRaw,
      });

    // (d) write the payments row idempotently and correlate the Consumer's
    // Activity transfer row (the USDC settled on-chain, so it is a Payment
    // regardless of any downstream payout).
    await this.db.client
      .insert(payments)
      .values({
        intentId,
        merchantId: intent.merchantId,
        consumerId,
        usdcSettlementRaw: intent.usdcSettlementRaw,
        txSignature: signature,
        settledAt: new Date(),
      })
      .onConflictDoNothing({ target: payments.intentId });
    const [payment] = await this.db.client
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.intentId, intentId))
      .limit(1);
    if (payment) {
      await this.db.client
        .update(transfers)
        .set({ kind: 'payment', paymentId: payment.id })
        .where(
          and(
            eq(transfers.signature, signature),
            eq(transfers.kind, 'transfer'),
          ),
        );
    }

    // (e)/(f) key off the provider completion.
    if (completion.status === 'complete' && payment) {
      await this.finalizeIntentSucceeded(intentId, payment.id, completion);
    } else {
      // Deferred: USDC confirmed, awaiting the off-ramp payout. Leave the
      // intent in settling; Phase 8's Blockradar webhook later calls
      // completeDeferredSettlement when naira lands. No new enum state.
      this.logger.log(
        `settlement.confirm intent_id=${intentId} outcome=usdc_confirmed_awaiting_payout`,
      );
    }
  }

  /**
   * The Phase-4-owned naira seam. Phase 8's Blockradar webhook calls this
   * when naira lands for a previously-pending payment. Idempotent by
   * construction (the rowCount-guarded settling->succeeded transition means a
   * second delivery no-ops). The direct-USDC pilot never reaches this path.
   */
  async completeDeferredSettlement(
    paymentId: string,
    completion: SettlementCompletion,
  ): Promise<void> {
    const [payment] = await this.db.client
      .select({ intentId: payments.intentId })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);
    if (!payment) {
      return;
    }
    await this.finalizeIntentSucceeded(payment.intentId, paymentId, completion);
  }

  /** Idempotent failure finalize (rowCount-guarded, publishes payment.failed). */
  async finalizeFailed(
    intentId: string,
    signature: string,
    reason: FailureReason,
  ): Promise<void> {
    const reasonText =
      typeof reason === 'string' ? reason : JSON.stringify(reason);
    const claimed = await this.db.client
      .update(paymentAttempts)
      .set({
        status: 'failed',
        failureReason: reasonText,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentAttempts.txSignature, signature),
          eq(paymentAttempts.status, 'settling'),
        ),
      )
      .returning({ intentId: paymentAttempts.intentId });
    if (claimed.length === 0) {
      return;
    }
    try {
      await this.intents.transition(intentId, 'settling', 'failed', {});
    } catch (err) {
      if (err instanceof IntentStateConflictError) return;
      throw err;
    }
    await this.events.publish({
      topic: 'payment.failed',
      key: intentId,
      payload: { intentId, signature, reason: reasonText },
      correlationId: intentId,
    });
    this.logger.log(
      `settlement.confirm intent_id=${intentId} outcome=failed reason=${reasonText}`,
    );
  }

  /**
   * The single payment.succeeded publish site. Idempotent: the rowCount-
   * guarded settling->succeeded transition means a duplicate never re-fires
   * the event.
   */
  private async finalizeIntentSucceeded(
    intentId: string,
    paymentId: string,
    completion: SettlementCompletion,
  ): Promise<void> {
    const [payment] = await this.db.client
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);
    if (!payment) {
      return;
    }
    try {
      await this.intents.transition(intentId, 'settling', 'succeeded', {});
    } catch (err) {
      if (err instanceof IntentStateConflictError) return;
      throw err;
    }
    await this.events.publish({
      topic: 'payment.succeeded',
      key: intentId,
      payload: {
        intentId,
        paymentId,
        merchantId: payment.merchantId,
        consumerId: payment.consumerId,
        usdcSettlementRaw: payment.usdcSettlementRaw,
        signature: payment.txSignature,
        ngnSettledMinor: completion.ngnSettledMinor,
        providerTxRef: completion.providerTxRef,
      },
      correlationId: intentId,
    });
    this.logger.log(
      `settlement.confirm intent_id=${intentId} outcome=succeeded`,
    );
  }
}
