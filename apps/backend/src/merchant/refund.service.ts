import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import {
  paymentIntents,
  payments,
  refunds,
  settlementAccounts,
  smartAccounts,
} from '../db/schema';
import { SettlementRouter } from '../settlement/settlement-router';
import { IdempotencyService } from './idempotency.service';
import {
  PaymentNotRefundableError,
  RefundAmountExceedsRefundableError,
  RefundNotFoundError,
  RefundNotSupportedError,
} from './merchant.errors';
import type { RefundObject } from './refund.dtos';

export interface RefundParams {
  paymentId: string;
  amountUsdcRaw?: string;
  reason?: string;
  idempotencyKey?: string;
}

/**
 * Ops-initiated, partial-capable refunds. A succeeded Payment is reversed
 * through Phase 4's SettlementProvider.reverse() at the provider's live rate
 * at refund time (never the pinned checkout quote). The durable refunds row is
 * written BEFORE the provider call (crash-safe), and the whole write is
 * idempotent by Idempotency-Key so a retry never double-reverses. The
 * naira/Blockradar reverse path is capability-gated (REFUND_NOT_SUPPORTED)
 * until Phase 8; the direct-USDC pilot path works now.
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

    const result = await this.idempotency.run<RefundObject>(
      payment.merchantId,
      params.idempotencyKey,
      requestHash,
      () => this.execute(payment, params),
    );
    return result.body;
  }

  private async execute(
    payment: typeof payments.$inferSelect,
    params: RefundParams,
  ): Promise<{ status: number; body: RefundObject }> {
    const [intent] = await this.db.client
      .select({ status: paymentIntents.status })
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

    const [consumerAccount] = await this.db.client
      .select({ walletAddress: smartAccounts.walletAddress })
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, payment.consumerId))
      .limit(1);
    if (!consumerAccount) {
      throw new RefundNotSupportedError(
        `no Consumer Account for payment ${payment.id}`,
      );
    }

    // Durable record first, then the provider reverse (crash-safe).
    const [refundRow] = await this.db.client
      .insert(refunds)
      .values({
        paymentId: payment.id,
        merchantId: payment.merchantId,
        status: 'pending',
        amountUsdcRaw: requested.toString(),
        reason: params.reason ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
      })
      .returning();

    try {
      const { signature } = await provider.reverse({
        endpointAddress: account.address,
        consumerAddress: consumerAccount.walletAddress,
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
}
