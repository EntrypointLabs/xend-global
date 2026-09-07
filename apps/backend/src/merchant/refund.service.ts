import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import {
  paymentIntents,
  payments,
  refunds,
  settlementAccounts,
} from '../db/schema';
import { findVaultAddress } from '../capability/vault-address';
import { SettlementRouter } from '../settlement/settlement-router';
import { IdempotencyService } from './idempotency.service';
import {
  IdempotencyKeyRequiredError,
  PaymentNotRefundableError,
  RefundAmountExceedsRefundableError,
  RefundNotFoundError,
  RefundNotSupportedError,
} from './merchant.errors';
import type { RefundObject } from './refund.dtos';

/** Postgres unique-violation SQLSTATE, surfaced by node-postgres. */
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

export interface RefundParams {
  paymentId: string;
  amountUsdcRaw?: string;
  reason?: string;
  idempotencyKey: string;
}

/**
 * Ops-initiated, partial-capable refunds. A succeeded Payment is reversed
 * through Phase 4's SettlementProvider.reverse() at the provider's live rate
 * at refund time (never the pinned checkout quote). The durable refunds row is
 * written BEFORE the provider call (crash-safe), and the whole write is
 * idempotent by Idempotency-Key so a retry never double-reverses. The key is
 * mandatory and the remainder check runs under a per-payment advisory lock,
 * so two distinct requests for the same payment are decided one after the
 * other rather than both reading the same remainder. The naira/Blockradar
 * reverse path is capability-gated (REFUND_NOT_SUPPORTED) until Phase 8; the
 * direct-USDC pilot path works now.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly db: DbService,
    private readonly router: SettlementRouter,
    private readonly idempotency: IdempotencyService,
  ) {}

  async refund(params: RefundParams): Promise<RefundObject> {
    if (!params.idempotencyKey) {
      throw new IdempotencyKeyRequiredError(
        'refunds require an Idempotency-Key header',
      );
    }
    const [payment] = await this.db.client
      .select()
      .from(payments)
      .where(eq(payments.id, params.paymentId))
      .limit(1);
    if (!payment) {
      throw new RefundNotFoundError(`payment ${params.paymentId} not found`);
    }

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          paymentId: params.paymentId,
          amountUsdcRaw: params.amountUsdcRaw ?? null,
          reason: params.reason ?? null,
        }),
      )
      .digest('hex');

    const result = await this.db.withAdvisoryLock(
      `refund:payment:${payment.id}`,
      () =>
        this.idempotency.run<RefundObject>(
          payment.merchantId,
          params.idempotencyKey,
          requestHash,
          () => this.execute(payment, params),
        ),
    );
    return result.body;
  }

  private async execute(
    payment: typeof payments.$inferSelect,
    params: RefundParams,
  ): Promise<{ status: number; body: RefundObject }> {
    const [intent] = await this.db.client
      .select({ status: paymentIntents.status, mode: paymentIntents.mode })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, payment.intentId))
      .limit(1);
    if (!intent || intent.status !== 'succeeded') {
      throw new PaymentNotRefundableError(
        `payment ${payment.id} is not settlement-confirmed`,
      );
    }

    // Refundable remainder: settled amount minus non-failed refunds (BigInt).
    const prior = await this.db.client
      .select({ amountUsdcRaw: refunds.amountUsdcRaw })
      .from(refunds)
      .where(
        and(eq(refunds.paymentId, payment.id), ne(refunds.status, 'failed')),
      );
    const refunded = prior.reduce(
      (sum, r) => sum + BigInt(r.amountUsdcRaw),
      0n,
    );
    const remainder = BigInt(payment.usdcSettlementRaw) - refunded;
    const requested = params.amountUsdcRaw
      ? BigInt(params.amountUsdcRaw)
      : remainder;
    if (requested <= 0n || requested > remainder) {
      throw new RefundAmountExceedsRefundableError(
        `refund amount ${requested} exceeds refundable remainder ${remainder}`,
      );
    }

    // A test-mode Payment was never settled on any chain, so its refund is
    // simulated the same way: a durable refunds row under a `test_` reference,
    // with no provider, no vault and no signer involved.
    if (intent.mode === 'test') {
      const inserted = await this.insertRefundRow(payment, requested, params);
      if ('existing' in inserted) {
        return { status: 200, body: this.toRefundObject(inserted.existing) };
      }
      const reference = `test_${inserted.row.id}`;
      await this.db.client
        .update(refunds)
        .set({
          status: 'succeeded',
          providerReference: reference,
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, inserted.row.id));
      this.logger.log(
        `refund.reverse refund_id=${inserted.row.id} payment_id=${payment.id} amount_raw=${requested} simulated=true`,
      );
      return {
        status: 200,
        body: this.toRefundObject({
          ...inserted.row,
          status: 'succeeded',
          providerReference: reference,
        }),
      };
    }

    const [account] = await this.db.client
      .select()
      .from(settlementAccounts)
      .where(eq(settlementAccounts.merchantId, payment.merchantId))
      .limit(1);
    if (!account || !account.address) {
      throw new RefundNotSupportedError(
        `merchant ${payment.merchantId} has no provisioned settlement endpoint`,
      );
    }

    const provider = this.router.forMerchant(account.currency);
    if (!provider.capabilities.refundSupport) {
      throw new RefundNotSupportedError(
        `settlement provider does not advertise reverse support yet`,
      );
    }

    // The money goes back where it came from: the Consumer's vault, never the
    // signer that spent it.
    const vaultAddress = await findVaultAddress(this.db, payment.consumerId);
    if (!vaultAddress) {
      throw new RefundNotSupportedError(
        `no Consumer Account for payment ${payment.id}`,
      );
    }

    const inserted = await this.insertRefundRow(payment, requested, params);
    if ('existing' in inserted) {
      return { status: 200, body: this.toRefundObject(inserted.existing) };
    }
    const refundRow = inserted.row;

    try {
      const { signature } = await provider.reverse({
        endpointAddress: account.address,
        consumerAddress: vaultAddress,
        amountRaw: requested.toString(),
        paymentId: payment.id,
      });
      await this.db.client
        .update(refunds)
        .set({
          status: 'succeeded',
          providerReference: signature,
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, refundRow.id));

      this.logger.log(
        `refund.reverse refund_id=${refundRow.id} payment_id=${payment.id} amount_raw=${requested} signature=${signature}`,
      );

      return {
        status: 200,
        body: {
          id: refundRow.id,
          object: 'refund',
          payment_id: payment.id,
          status: 'succeeded',
          amount_usdc_raw: requested.toString(),
          provider_reference: signature,
          created: Math.floor(refundRow.createdAt.getTime() / 1000),
        },
      };
    } catch (err) {
      await this.db.client
        .update(refunds)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(refunds.id, refundRow.id));
      throw err;
    }
  }

  /**
   * Durable record first, then the reverse (crash-safe). The insert is also
   * the last concurrency guard: the (merchant, idempotency_key) unique index
   * means a duplicate refund request loses here (23505) BEFORE it can reverse
   * funds a second time, and gets the winner's record instead.
   */
  private async insertRefundRow(
    payment: typeof payments.$inferSelect,
    requested: bigint,
    params: RefundParams,
  ): Promise<
    | { row: typeof refunds.$inferSelect }
    | { existing: typeof refunds.$inferSelect }
  > {
    try {
      const [row] = await this.db.client
        .insert(refunds)
        .values({
          paymentId: payment.id,
          merchantId: payment.merchantId,
          status: 'pending',
          amountUsdcRaw: requested.toString(),
          reason: params.reason ?? null,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();
      return { row };
    } catch (err) {
      if (pgErrorCode(err) === '23505') {
        const [existing] = await this.db.client
          .select()
          .from(refunds)
          .where(
            and(
              eq(refunds.merchantId, payment.merchantId),
              eq(refunds.idempotencyKey, params.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) return { existing };
      }
      throw err;
    }
  }

  private toRefundObject(row: typeof refunds.$inferSelect): RefundObject {
    return {
      id: row.id,
      object: 'refund',
      payment_id: row.paymentId,
      status: row.status,
      amount_usdc_raw: row.amountUsdcRaw,
      provider_reference: row.providerReference,
      created: Math.floor(row.createdAt.getTime() / 1000),
    };
  }
}
