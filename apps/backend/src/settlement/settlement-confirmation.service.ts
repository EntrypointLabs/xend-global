import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
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

/** The blockhash-expiry window: an attempt older than this is definitively
 *  dead (its pinned blockhash can no longer land), mirroring the activity
 *  reconciler's PENDING_EXPIRY_MS. */
const BLOCKHASH_EXPIRY_SECONDS = 120;
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
    await this.reapAuthorized();
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
      if (
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      ) {
        await this.finalizeSucceeded(row.intentId, row.txSignature);
      } else if (status?.err) {
        await this.finalizeFailed(row.intentId, row.txSignature, {
          code: 'CHAIN_ERROR',
          err: status.err,
        });
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
        this.logger.warn(
          `settlement.reap.orphan_suspected attempt_id=${row.id} intent_id=${row.intentId} merchant_id=${row.merchantId} amount_raw=${row.usdcSettlementRaw}`,
        );
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
