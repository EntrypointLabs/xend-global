import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, lt } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { merchants, paymentIntents } from '../db/schema';
import { EVENT_PUBLISHER } from '../events/event-publisher.interface';
import type { EventPublisher } from '../events/event-publisher.interface';
import {
  IntentNotFoundError,
  IntentStateConflictError,
  MerchantNotFoundError,
  MerchantSuspendedError,
} from './payment.errors';

type IntentRow = typeof paymentIntents.$inferSelect;
type PaymentIntentStatus = IntentRow['status'];
type IntentPatch = Partial<typeof paymentIntents.$inferInsert>;

/** Postgres unique-violation SQLSTATE, surfaced by node-postgres. */
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

export interface CreateIntentParams {
  merchantId: string;
  usdcSettlementRaw: string;
  ngnDisplayMinor?: string;
  fxRate?: string;
  fxSource?: string;
  fxQuotedAt?: Date;
  merchantReference?: string;
  idempotencyKey?: string;
  /** The api-key mode the intent is created under; defaults to test. */
  mode?: 'test' | 'live';
  /** Merchant-supplied redirect targets, SSRF-validated by the caller. */
  returnUrl?: string;
  cancelUrl?: string;
}

/**
 * Durable Payment intents. Every read and write hits Postgres; there is no
 * in-memory intent state. Replaying the same (merchant, idempotency key)
 * returns the existing intent instead of creating a second one, and status
 * only ever changes through the conditional {@link transition}, which is the
 * race arbiter for concurrent confirmers.
 */
@Injectable()
export class PaymentIntentService {
  private readonly logger = new Logger(PaymentIntentService.name);

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async create(params: CreateIntentParams): Promise<IntentRow> {
    const [merchant] = await this.db.client
      .select()
      .from(merchants)
      .where(eq(merchants.id, params.merchantId))
      .limit(1);
    if (!merchant) {
      throw new MerchantNotFoundError(
        `merchant ${params.merchantId} not found`,
      );
    }
    if (merchant.status !== 'active') {
      throw new MerchantSuspendedError(
        `merchant ${params.merchantId} is ${merchant.status}`,
      );
    }

    let amount: bigint;
    try {
      amount = BigInt(params.usdcSettlementRaw);
    } catch {
      throw new Error('usdcSettlementRaw must be a positive integer string');
    }
    if (amount <= 0n) {
      throw new Error('usdcSettlementRaw must be a positive integer string');
    }

    // Idempotency-first: a replay with the same key returns the original
    // intent and publishes nothing.
    if (params.idempotencyKey) {
      const existing = await this.findByIdempotency(
        params.merchantId,
        params.idempotencyKey,
      );
      if (existing) return existing;
    }

    const ttlMinutes =
      merchant.intentTtlMinutes ??
      this.config.getOrThrow<number>('PAYMENT_INTENT_TTL_MINUTES');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    let intent: IntentRow;
    try {
      [intent] = await this.db.client
        .insert(paymentIntents)
        .values({
          merchantId: params.merchantId,
          usdcSettlementRaw: params.usdcSettlementRaw,
          ngnDisplayMinor: params.ngnDisplayMinor ?? null,
          fxRate: params.fxRate ?? null,
          fxSource: params.fxSource ?? null,
          fxQuotedAt: params.fxQuotedAt ?? null,
          merchantReference: params.merchantReference ?? null,
          idempotencyKey: params.idempotencyKey ?? null,
          mode: params.mode ?? 'test',
          returnUrl: params.returnUrl ?? null,
          cancelUrl: params.cancelUrl ?? null,
          expiresAt,
        })
        .returning();
    } catch (err) {
      // Lost the race on the merchant-idempotency unique index: the winning
      // intent already exists, so return it instead of a second row.
      if (pgErrorCode(err) === '23505' && params.idempotencyKey) {
        const winner = await this.findByIdempotency(
          params.merchantId,
          params.idempotencyKey,
        );
        if (winner) return winner;
      }
      throw err;
    }

    // The intent id IS the correlation id: one id traces the Payment across
    // every service (ADR 0012).
    await this.events.publish({
      topic: 'payment.created',
      key: intent.id,
      payload: {
        intentId: intent.id,
        merchantId: intent.merchantId,
        usdcSettlementRaw: intent.usdcSettlementRaw,
        ngnDisplayMinor: intent.ngnDisplayMinor,
        expiresAt: intent.expiresAt.toISOString(),
      },
      correlationId: intent.id,
    });

    return intent;
  }

  /**
   * The only status-write path. A single conditional UPDATE gated on the
   * expected current status: two racing confirmers cannot both win because
   * the second one's WHERE matches zero rows.
   */
  async transition(
    intentId: string,
    from: PaymentIntentStatus,
    to: PaymentIntentStatus,
    patch: IntentPatch = {},
  ): Promise<IntentRow> {
    const [updated] = await this.db.client
      .update(paymentIntents)
      .set({ ...patch, status: to, updatedAt: new Date() })
      .where(
        and(eq(paymentIntents.id, intentId), eq(paymentIntents.status, from)),
      )
      .returning();
    if (updated) return updated;

    const existing = await this.findByIdOrNull(intentId);
    if (!existing) {
      throw new IntentNotFoundError(`intent ${intentId} not found`);
    }
    throw new IntentStateConflictError(
      `intent ${intentId} expected status ${from} but was ${existing.status}`,
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStale(): Promise<void> {
    const now = new Date();
    const expired = await this.db.client
      .update(paymentIntents)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(paymentIntents.status, 'created'),
          lt(paymentIntents.expiresAt, now),
        ),
      )
      .returning({ id: paymentIntents.id });

    for (const row of expired) {
      await this.events.publish({
        topic: 'payment.expired',
        key: row.id,
        payload: { intentId: row.id },
        correlationId: row.id,
      });
    }
    if (expired.length > 0) {
      this.logger.log(`payment.intent.expired count=${expired.length}`);
    }
  }

  async findById(intentId: string): Promise<IntentRow> {
    const row = await this.findByIdOrNull(intentId);
    if (!row) throw new IntentNotFoundError(`intent ${intentId} not found`);
    return row;
  }

  private async findByIdOrNull(
    intentId: string,
  ): Promise<IntentRow | undefined> {
    const [row] = await this.db.client
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    return row;
  }

  private async findByIdempotency(
    merchantId: string,
    idempotencyKey: string,
  ): Promise<IntentRow | undefined> {
    const [row] = await this.db.client
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.merchantId, merchantId),
          eq(paymentIntents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row;
  }
}
