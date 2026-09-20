import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, ilike, lt, or } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import {
  paymentAttempts,
  paymentIntents,
  payments,
  webhookDeliveries,
} from '../db/schema';
import { MerchantOwnerService } from './merchant-owner.service';

const INTENT_STATUSES = [
  'created',
  'authorized',
  'settling',
  'succeeded',
  'failed',
  'expired',
  'canceled',
] as const;
type IntentStatus = (typeof INTENT_STATUSES)[number];

/**
 * Owner-authenticated Payments history and detail. Every row is scoped to the
 * authenticated Merchant, so a query can never reach another Merchant's
 * Payments. The list is keyset-paginated on (createdAt desc, id desc) so a new
 * Payment arriving mid-scroll never shifts the page.
 */
@Controller('merchant-portal/payments')
export class MerchantPortalPaymentsController {
  constructor(
    private readonly db: DbService,
    private readonly owner: MerchantOwnerService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(
    @Headers('authorization') authorization: string | undefined,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const merchant = await this.owner.owned(authorization);
    const cluster = this.config.getOrThrow<string>('SOLANA_CLUSTER');
    const take = clampLimit(limit, 20, 100);
    const statusFilter = INTENT_STATUSES.includes(status as IntentStatus)
      ? (status as IntentStatus)
      : undefined;
    const search = q?.trim();
    const after = cursor ? await this.cursorRow(merchant.id, cursor) : null;

    const rows = await this.db.client
      .select({
        id: paymentIntents.id,
        status: paymentIntents.status,
        usdcSettlementRaw: paymentIntents.usdcSettlementRaw,
        displayCurrency: paymentIntents.displayCurrency,
        displayAmountMinor: paymentIntents.displayAmountMinor,
        merchantReference: paymentIntents.merchantReference,
        mode: paymentIntents.mode,
        createdAt: paymentIntents.createdAt,
      })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.merchantId, merchant.id),
          eq(paymentIntents.executionCluster, cluster),
          ...(statusFilter ? [eq(paymentIntents.status, statusFilter)] : []),
          ...(search
            ? [
                or(
                  ilike(paymentIntents.id, `%${search}%`),
                  ilike(paymentIntents.merchantReference, `%${search}%`),
                ),
              ]
            : []),
          ...(after
            ? [
                or(
                  lt(paymentIntents.createdAt, after.createdAt),
                  and(
                    eq(paymentIntents.createdAt, after.createdAt),
                    lt(paymentIntents.id, after.id),
                  ),
                ),
              ]
            : []),
        ),
      )
      .orderBy(desc(paymentIntents.createdAt), desc(paymentIntents.id))
      .limit(take + 1);

    const page = rows.slice(0, take);
    return {
      payments: page.map((row) => ({
        id: row.id,
        status: row.status,
        usdcSettlementRaw: row.usdcSettlementRaw,
        displayCurrency: row.displayCurrency,
        displayAmountMinor: row.displayAmountMinor,
        merchantReference: row.merchantReference,
        mode: row.mode,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  @Get(':id')
  async detail(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    const merchant = await this.owner.owned(authorization);
    const cluster = this.config.getOrThrow<string>('SOLANA_CLUSTER');
    const [intent] = await this.db.client
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.id, id),
          eq(paymentIntents.merchantId, merchant.id),
          eq(paymentIntents.executionCluster, cluster),
        ),
      )
      .limit(1);
    if (!intent) throw new NotFoundException('Payment not found');

    const [latestAttempt] = await this.db.client
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.intentId, intent.id))
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(1);
    const [payment] = await this.db.client
      .select()
      .from(payments)
      .where(eq(payments.intentId, intent.id))
      .limit(1);
    // The intent id is the correlation id carried on every webhook for this
    // Payment, so its deliveries surface the merchant's own delivery status.
    const deliveries = await this.db.client
      .select({
        id: webhookDeliveries.id,
        eventType: webhookDeliveries.eventType,
        status: webhookDeliveries.status,
        attemptNo: webhookDeliveries.attemptNo,
        responseStatus: webhookDeliveries.responseStatus,
        createdAt: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.correlationId, intent.id))
      .orderBy(desc(webhookDeliveries.createdAt));

    const confirmationReference =
      payment?.txSignature ?? latestAttempt?.txSignature ?? null;

    return {
      id: intent.id,
      status: intent.status,
      mode: intent.mode,
      usdcSettlementRaw: intent.usdcSettlementRaw,
      displayCurrency: intent.displayCurrency,
      displayAmountMinor: intent.displayAmountMinor,
      pricingCurrency: intent.pricingCurrency,
      fxRate: intent.fxRate,
      fxSource: intent.fxSource,
      fxQuotedAt: intent.fxQuotedAt?.toISOString() ?? null,
      merchantReference: intent.merchantReference,
      metadata: intent.metadata ?? null,
      confirmationReference,
      failureReason: latestAttempt?.failureReason ?? null,
      createdAt: intent.createdAt.toISOString(),
      expiresAt: intent.expiresAt.toISOString(),
      authorizedAt: intent.authorizedAt?.toISOString() ?? null,
      settledAt: payment?.settledAt?.toISOString() ?? null,
      webhookDeliveries: deliveries.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        status: row.status,
        attemptNo: row.attemptNo,
        responseStatus: row.responseStatus,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private async cursorRow(merchantId: string, cursor: string) {
    const [row] = await this.db.client
      .select({
        id: paymentIntents.id,
        createdAt: paymentIntents.createdAt,
      })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.id, cursor),
          eq(paymentIntents.merchantId, merchantId),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

function clampLimit(raw: string | undefined, fallback: number, max: number) {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}
