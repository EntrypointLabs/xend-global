import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import {
  paymentAttempts,
  paymentIntents,
  payments,
  transfers,
} from '../db/schema';
import { LiveIntentOnSimulatedPathError } from '../capability/capability.errors';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import { PaymentIntentService } from '../payment/payment-intent.service';
import { IntentStateConflictError } from '../payment/payment.errors';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../events/event-publisher.interface';
import { settlementConfirmations } from '../metrics/metrics';
import { SettlementProvisioningService } from './settlement-provisioning.service';
import { SettlementRouter } from './settlement-router';
import type { SettlementCompletion } from './settlement-provider.interface';

type FailureReason = string | { code: string; [key: string]: unknown };
type IntentRow = typeof paymentIntents.$inferSelect;

/** Every simulated settlement signature starts with this; none can be looked up on any cluster. */
export const TEST_SIGNATURE_PREFIX = 'test_';

/** The blockhash-expiry window: an attempt older than this is definitively
 *  dead (its pinned blockhash can no longer land), mirroring the activity
 *  reconciler's PENDING_EXPIRY_MS. */
const BLOCKHASH_EXPIRY_SECONDS = 120;
/** How long a claimed attempt may sit without a payments row before the
 *  sweep assumes the claiming process died and finishes the job. */
const CLAIM_RESUME_AFTER_SECONDS = 60;
const REAP_BATCH = 256;

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
      // A transaction that landed with an error is confirmed too, so the
      // error is the verdict and must be read before the confirmation level.
      if (status?.err) {
        await this.finalizeFailed(intentId, signature, {
          code: 'CHAIN_ERROR',
          err: status.err,
        });
        return;
      }
      if (
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      ) {
        await this.finalizeSucceeded(intentId, signature);
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
    await this.completeClaimedSettlement(intentId, signature);
  }

  /**
   * Everything after the claim: provider completion, the payments row, the
   * Activity linkage, and the intent transition. Separated from the claim so
   * the sweep can rerun it for an attempt that was claimed and then lost its
   * process before the payments row was written.
   */
  private async completeClaimedSettlement(
    intentId: string,
    signature: string,
  ): Promise<void> {
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
        displayCurrency: intent.displayCurrency,
        displayAmountMinor: intent.displayAmountMinor,
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

  /**
   * Sandbox settlement for a test-mode intent, in every environment. Nothing
   * is built, signed, broadcast or confirmed and no provider is called; the
   * authorized attempt is retired under a `test_` signature, the payments row
   * is written and the same payment.succeeded event a real confirmation
   * publishes goes out, so webhooks and reads behave as they will live. A
   * live intent is refused before anything is written.
   */
  async settleTestMode(intentId: string): Promise<void> {
    const intent = await this.intents.findById(intentId);
    if (intent.mode !== 'test') {
      throw new LiveIntentOnSimulatedPathError(
        `intent ${intentId} is live and cannot settle through the simulated path`,
      );
    }
    await this.simulateSettlement(
      intent,
      `${TEST_SIGNATURE_PREFIX}${intentId}`,
    );
    this.logger.log(
      `settlement.confirm intent_id=${intentId} outcome=succeeded simulated=true`,
    );
  }

  /**
   * TEST ONLY, never production. Dev short-circuit for a LIVE-mode intent in
   * local checkout: with no funded settlement authority on devnet, a real
   * settlement tx never confirms and /checkout/authorize would time out
   * (PAYMENT_PROCESSING). Test-mode intents never need this; they take
   * {@link settleTestMode}. Hard-gated on NODE_ENV==='development'.
   */
  async devForceSettleSucceeded(intentId: string): Promise<void> {
    if (this.config.get<string>('NODE_ENV') !== 'development') {
      throw new Error('devForceSettleSucceeded is dev-only');
    }
    const intent = await this.intents.findById(intentId);
    await this.simulateSettlement(intent, `devtest_sig_${intentId}`);
    this.logger.log(
      `settlement.confirm intent_id=${intentId} outcome=succeeded (DEV force short-circuit)`,
    );
  }

  private async simulateSettlement(
    intent: IntentRow,
    signature: string,
  ): Promise<void> {
    const intentId = intent.id;
    const consumerId = intent.consumerId;
    if (!consumerId) {
      throw new Error(`intent ${intentId} has no consumer`);
    }

    // Retire the live authorized attempt under the synthetic signature so the
    // settlement reaper never touches it (there is no on-chain tx to confirm).
    await this.db.client
      .update(paymentAttempts)
      .set({
        txSignature: signature,
        status: 'succeeded',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentAttempts.intentId, intentId),
          eq(paymentAttempts.status, 'authorized'),
        ),
      );

    // The shared succeeded finalize transitions settling->succeeded, so move
    // the intent into settling first (mirrors the real submit leg).
    await this.intents.transition(intentId, 'authorized', 'settling', {});

    // Idempotent payments row (mirrors finalizeSucceeded step d).
    await this.db.client
      .insert(payments)
      .values({
        intentId,
        merchantId: intent.merchantId,
        consumerId,
        usdcSettlementRaw: intent.usdcSettlementRaw,
        displayCurrency: intent.displayCurrency,
        displayAmountMinor: intent.displayAmountMinor,
        txSignature: signature,
        settledAt: new Date(),
      })
      .onConflictDoNothing({ target: payments.intentId });
    const [payment] = await this.db.client
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.intentId, intentId))
      .limit(1);
    if (!payment) {
      return;
    }

    await this.finalizeIntentSucceeded(intentId, payment.id, {
      status: 'complete',
      ngnSettledMinor:
        intent.displayCurrency === 'NGN'
          ? intent.displayAmountMinor
          : undefined,
      providerTxRef: signature,
    });
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
    settlementConfirmations.inc({
      outcome:
        typeof reason !== 'string' && reason.code === 'BLOCKHASH_EXPIRED'
          ? 'timed_out'
          : 'failed',
    });
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
   * The settlement sweep: the tail safety net behind the active poll AND the
   * guard-completeness fix. Two legs over bounded batches:
   *
   *   (a) Settling leg (tail of the confirmation race): settling attempts
   *       with a signature are resolved via getSignatureStatuses; a null
   *       status past the blockhash-expiry window is force-failed
   *       (BLOCKHASH_EXPIRED), the "definitively dead" signal that frees the
   *       one-live-attempt partial unique index for a signature-first retry.
   *
   *   (b) Stuck-authorized reaper (guard completeness): authorized attempts
   *       older than the same window are force-failed, freeing the index.
   *       Covers abandon-after-pin AND the crash window between the relayer
   *       broadcast and the signature-record UPDATE.
   *
   * The durable invariant is NEVER reap before the window closes: any
   * broadcast whose signature went unrecorded is by then either dead (its
   * pinned blockhash expired) or already landed and observable by the tailer
   * as a confirmed transfer, and the relayer's bounded LRU replay guard
   * refuses an immediate duplicate co-sign.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async reconcileSettling(): Promise<void> {
    await this.sweepSettlingLeg();
    await this.resumeClaimedSettlements();
    await this.reapAuthorized();
  }

  /**
   * Claim-first finalize means a crash between the attempt claim and the
   * payments insert leaves the attempt succeeded, the intent settling, and no
   * payments row: nothing else would ever touch it again. Rerun the
   * post-claim steps for those. A deferred naira Payment has its payments row
   * and is deliberately left in settling for the off-ramp signal.
   */
  private async resumeClaimedSettlements(): Promise<void> {
    const rows = (await this.db.client.execute(sql`
      SELECT pa.tx_signature AS "txSignature", pa.intent_id AS "intentId"
      FROM payment_attempts pa
      JOIN payment_intents pi ON pi.id = pa.intent_id
      LEFT JOIN payments p ON p.intent_id = pa.intent_id
      WHERE pa.status = 'succeeded'
        AND pi.status IN ('settling')
        AND p.id IS NULL
        AND pa.tx_signature IS NOT NULL
        AND pa.updated_at < (now() AT TIME ZONE 'UTC') - INTERVAL '${sql.raw(`${CLAIM_RESUME_AFTER_SECONDS}`)} seconds'
      ORDER BY pa.updated_at ASC
      LIMIT ${sql.raw(`${REAP_BATCH}`)}
    `)) as unknown as {
      rows: { txSignature: string; intentId: string }[];
    };
    for (const row of rows.rows) {
      this.logger.warn(
        `settlement.confirm.resume intent_id=${row.intentId} signature=${row.txSignature}`,
      );
      try {
        await this.completeClaimedSettlement(row.intentId, row.txSignature);
      } catch (err) {
        this.logger.error(
          `settlement.confirm.resume_failed intent_id=${row.intentId}`,
          err,
        );
      }
    }
  }

  private async sweepSettlingLeg(): Promise<void> {
    const rows = (await this.db.client.execute(sql`
      SELECT
        pa.tx_signature AS "txSignature",
        pa.intent_id AS "intentId",
        pa.updated_at < (now() AT TIME ZONE 'UTC') - INTERVAL '${sql.raw(`${BLOCKHASH_EXPIRY_SECONDS}`)} seconds'
          AS "expired"
      FROM payment_attempts pa
      WHERE pa.status = 'settling' AND pa.tx_signature IS NOT NULL
      ORDER BY pa.updated_at ASC
      LIMIT ${sql.raw(`${REAP_BATCH}`)}
    `)) as unknown as {
      rows: { txSignature: string; intentId: string; expired: boolean }[];
    };
    for (const row of rows.rows) {
      const [status] = await this.solana.getSignatureStatuses([
        row.txSignature,
      ]);
      if (status?.err) {
        await this.finalizeFailed(row.intentId, row.txSignature, {
          code: 'CHAIN_ERROR',
          err: status.err,
        });
      } else if (
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      ) {
        await this.finalizeSucceeded(row.intentId, row.txSignature);
      } else if (row.expired) {
        await this.finalizeFailed(row.intentId, row.txSignature, {
          code: 'BLOCKHASH_EXPIRED',
        });
      }
    }
  }

  private async reapAuthorized(): Promise<void> {
    const rows = (await this.db.client.execute(sql`
      SELECT
        pa.id AS "id",
        pa.intent_id AS "intentId",
        pa.message_base64 AS "messageBase64",
        pi.merchant_id AS "merchantId",
        pi.usdc_settlement_raw AS "usdcSettlementRaw"
      FROM payment_attempts pa
      JOIN payment_intents pi ON pi.id = pa.intent_id
      WHERE pa.status = 'authorized'
        AND pa.updated_at < (now() AT TIME ZONE 'UTC') - INTERVAL '${sql.raw(`${BLOCKHASH_EXPIRY_SECONDS}`)} seconds'
      ORDER BY pa.updated_at ASC
      LIMIT ${sql.raw(`${REAP_BATCH}`)}
    `)) as unknown as {
      rows: {
        id: string;
        intentId: string;
        messageBase64: string | null;
        merchantId: string;
        usdcSettlementRaw: string;
      }[];
    };
    for (const row of rows.rows) {
      // Refinement (crash+landed sub-case): if the attempt was pinned (has a
      // message) but never got a signature, its broadcast may have landed
      // under a signature we never recorded. Before silently freeing the
      // index, check the endpoint for a confirmed inbound transfer of the
      // exact amount inside the window; on a hit reap with a distinct code +
      // an ops alert. Accepted pilot-ops residual: an authority-owned endpoint
      // is shared by owner, so this heuristic is amount-and-window scoped, not
      // signature-exact.
      const orphanSuspected =
        row.messageBase64 != null &&
        (await this.hasSuspectedOrphanInbound(
          row.merchantId,
          row.usdcSettlementRaw,
        ));
      const code = orphanSuspected
        ? 'ATTEMPT_ORPHAN_SUSPECTED'
        : 'ATTEMPT_ABANDONED';
      const reaped = (await this.db.client.execute(sql`
        UPDATE payment_attempts
        SET status = 'failed',
            failure_reason = ${JSON.stringify({ code })},
            updated_at = NOW()
        WHERE id = ${row.id} AND status = 'authorized'
      `)) as unknown as { rowCount: number };
      if (reaped.rowCount === 0) continue;
      if (orphanSuspected) {
        // Money may have landed under a signature we never recorded: leave the
        // intent `authorized` for ops to resolve manually. Auto-failing here
        // could tell the merchant the payment failed after they were paid.
        this.logger.warn(
          `settlement.reap.orphan_suspected attempt_id=${row.id} intent_id=${row.intentId} merchant_id=${row.merchantId} amount_raw=${row.usdcSettlementRaw}`,
        );
      } else {
        // Clean abandonment: free the parent intent so it is not stranded
        // `authorized` with no live attempt (which authorize() cannot re-enter,
        // leaving the checkout permanently stuck). Move it to terminal `failed`
        // and notify the merchant. A conditional transition tolerates a race
        // with any concurrent terminal write.
        try {
          await this.intents.transition(
            row.intentId,
            'authorized',
            'failed',
            {},
          );
          settlementConfirmations.inc({ outcome: 'timed_out' });
          await this.events.publish({
            topic: 'payment.failed',
            key: row.intentId,
            payload: { intentId: row.intentId, reason: code },
            correlationId: row.intentId,
          });
        } catch (err) {
          if (!(err instanceof IntentStateConflictError)) throw err;
        }
      }
      this.logger.log(
        `settlement.reap attempt_id=${row.id} intent_id=${row.intentId} reason=${code}`,
      );
    }
  }

  private async hasSuspectedOrphanInbound(
    merchantId: string,
    amountRaw: string,
  ): Promise<boolean> {
    let endpoint: string;
    try {
      ({ address: endpoint } =
        await this.provisioning.getSettlementAddressForSettlement(merchantId));
    } catch {
      return false;
    }
    const hit = (await this.db.client.execute(sql`
      SELECT 1
      FROM transfers
      WHERE to_address = ${endpoint}
        AND amount_raw = ${amountRaw}
        AND status = 'CONFIRMED'
        AND kind = 'transfer'
        AND confirmed_at > (now() AT TIME ZONE 'UTC') - INTERVAL '${sql.raw(`${BLOCKHASH_EXPIRY_SECONDS}`)} seconds'
      LIMIT 1
    `)) as unknown as { rows: unknown[] };
    return hit.rows.length > 0;
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
    settlementConfirmations.inc({ outcome: 'succeeded' });
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
