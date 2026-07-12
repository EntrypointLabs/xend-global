import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { merchants, sessions } from '../db/schema';
import { EVENT_PUBLISHER } from '../events/event-publisher.interface';
import type { EventPublisher } from '../events/event-publisher.interface';
import { RATE_COUNTER } from '../counters/rate-counter.interface';
import type { RateCounter } from '../counters/rate-counter.interface';
import { SESSION_STORE } from './session-store.interface';
import type { SessionStore } from './session-store.interface';
import {
  SessionInvalidError,
  SessionNotFoundError,
  SessionVelocityExceededError,
} from './session.errors';
import type { SessionSummary } from './dtos';

type SessionRow = typeof sessions.$inferSelect;

/** Session velocity windows outlive their UTC day by a couple of hours. */
const VELOCITY_TTL_SECONDS = 26 * 60 * 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface IssueSessionParams {
  consumerId: string;
  merchantId: string;
  issuingIntentId?: string;
  uaHint?: string;
}

export interface IssuedSession {
  sessionId: string;
  token: string;
}

/**
 * Merchant-scoped Sessions. Tokens are opaque random strings, stored only as
 * their SHA-256 hash; the raw token crosses a boundary exactly once (at issue
 * or rotate) and is never logged or persisted. Postgres rows are the durable
 * truth for hash, binding, revocation, and absolute expiry; Redis is the hot
 * path for the sliding-inactivity window. A Session proves recognition, not
 * entitlement: capacity is still checked live on every Payment.
 */
@Injectable()
export class SessionService implements OnModuleInit {
  private readonly logger = new Logger(SessionService.name);
  private absoluteTtlDays!: number;
  private slidingSeconds!: number;
  private velocityMaxPayments!: number;
  private velocityMaxAmountRaw!: string;

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    @Inject(RATE_COUNTER) private readonly counter: RateCounter,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  onModuleInit() {
    this.absoluteTtlDays = this.config.getOrThrow<number>(
      'SESSION_ABSOLUTE_TTL_DAYS',
    );
    const slidingWindowDays = this.config.getOrThrow<number>(
      'SESSION_SLIDING_WINDOW_DAYS',
    );
    this.slidingSeconds = slidingWindowDays * 24 * 60 * 60;
    this.velocityMaxPayments = this.config.getOrThrow<number>(
      'SESSION_VELOCITY_MAX_PAYMENTS_PER_DAY',
    );
    this.velocityMaxAmountRaw = this.config.getOrThrow<string>(
      'SESSION_VELOCITY_MAX_AMOUNT_RAW_PER_DAY',
    );

    // Boot invariant: per-session velocity caps must sit at or below tier
    // caps. Read CAPACITY_TIERS through config (no module dependency on the
    // capability engine) and compare against the smallest tier daily cap.
    const tiers = JSON.parse(
      this.config.getOrThrow<string>('CAPACITY_TIERS'),
    ) as Record<string, { dailyCapRaw: string }>;
    const dailyCaps = Object.values(tiers).map((t) => BigInt(t.dailyCapRaw));
    if (dailyCaps.length === 0) {
      throw new Error('CAPACITY_TIERS has no tiers');
    }
    const minDailyCap = dailyCaps.reduce((a, b) => (b < a ? b : a));
    if (this.velocityMaxPayments < 1) {
      throw new Error('SESSION_VELOCITY_MAX_PAYMENTS_PER_DAY must be >= 1');
    }
    if (BigInt(this.velocityMaxAmountRaw) > minDailyCap) {
      throw new Error(
        'SESSION_VELOCITY_MAX_AMOUNT_RAW_PER_DAY must be at or below the smallest tier dailyCapRaw',
      );
    }

    this.logger.log(
      `session.init absolute_ttl_days=${this.absoluteTtlDays} sliding_window_days=${slidingWindowDays}`,
    );
  }

  async issue(params: IssueSessionParams): Promise<IssuedSession> {
    const token = this.mintToken();
    const expiresAt = new Date(Date.now() + this.absoluteTtlDays * MS_PER_DAY);
    const [row] = await this.db.client
      .insert(sessions)
      .values({
        tokenHash: this.hash(token),
        consumerId: params.consumerId,
        merchantId: params.merchantId,
        issuingIntentId: params.issuingIntentId ?? null,
        uaHint: params.uaHint ?? null,
        expiresAt,
      })
      .returning({ id: sessions.id });

    await this.store.touch(row.id, this.slidingSeconds);
    await this.events.publish({
      topic: 'session.issued',
      key: row.id,
      payload: {
        sessionId: row.id,
        consumerId: params.consumerId,
        merchantId: params.merchantId,
      },
      correlationId: params.issuingIntentId ?? row.id,
    });

    return { sessionId: row.id, token };
  }

  async validate(rawToken: string, merchantId: string): Promise<SessionRow> {
    const [session] = await this.db.client
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, this.hash(rawToken)))
      .limit(1);

    const now = Date.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.merchantId !== merchantId
    ) {
      throw new SessionInvalidError('session is not valid');
    }

    // Sliding window: Redis is the hot path, the row's last_used_at is the
    // durable fallback on a cache miss.
    const active = await this.store.isActive(session.id);
    if (!active) {
      const slidingMs = this.slidingSeconds * 1000;
      if (session.lastUsedAt.getTime() < now - slidingMs) {
        throw new SessionInvalidError('session is not valid');
      }
    }

    const touchedAt = new Date();
    await this.db.client
      .update(sessions)
      .set({ lastUsedAt: touchedAt, updatedAt: touchedAt })
      .where(eq(sessions.id, session.id));
    await this.store.touch(session.id, this.slidingSeconds);

    return session;
  }

  /**
   * Non-destructive recognition check for the checkout summary. Reads the same
   * validity conditions as {@link validate} (hash lookup, revocation, absolute
   * expiry, sliding window, merchant match) but writes NOTHING: no
   * last_used_at update, no store.touch, no rotation. Recognition must not
   * refresh the sliding window. Returns false on any failure or absent token.
   */
  async peek(rawToken: string, merchantId: string): Promise<boolean> {
    const [session] = await this.db.client
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, this.hash(rawToken)))
      .limit(1);

    const now = Date.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.merchantId !== merchantId
    ) {
      return false;
    }

    const active = await this.store.isActive(session.id);
    if (!active) {
      const slidingMs = this.slidingSeconds * 1000;
      if (session.lastUsedAt.getTime() < now - slidingMs) return false;
    }
    return true;
  }

  async rotate(sessionId: string): Promise<string> {
    const token = this.mintToken();
    const [updated] = await this.db.client
      .update(sessions)
      .set({ tokenHash: this.hash(token), updatedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (!updated) {
      throw new SessionInvalidError('session cannot be rotated');
    }
    return token;
  }

  async checkAndRecordVelocity(
    sessionId: string,
    amountRaw: string,
  ): Promise<void> {
    const key = `sess:velocity:${sessionId}:day:${this.dayStamp()}`;
    const snap = await this.counter.peek(key);
    if (snap.count + 1 > this.velocityMaxPayments) {
      throw new SessionVelocityExceededError(
        'session daily payment count cap reached',
      );
    }
    if (
      BigInt(snap.totalRaw) + BigInt(amountRaw) >
      BigInt(this.velocityMaxAmountRaw)
    ) {
      throw new SessionVelocityExceededError(
        'session daily amount cap reached',
      );
    }
    await this.counter.increment(key, amountRaw, VELOCITY_TTL_SECONDS);
  }

  async listForConsumer(consumerId: string): Promise<SessionSummary[]> {
    const rows = await this.db.client
      .select({
        id: sessions.id,
        merchantDisplayName: merchants.displayName,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(merchants, eq(sessions.merchantId, merchants.id))
      .where(
        and(
          eq(sessions.consumerId, consumerId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );

    return rows.map((r) => ({
      id: r.id,
      merchantDisplayName: r.merchantDisplayName,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  async revoke(consumerId: string, sessionId: string): Promise<void> {
    const [revoked] = await this.db.client
      .update(sessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.consumerId, consumerId),
          isNull(sessions.revokedAt),
        ),
      )
      .returning({ id: sessions.id });
    if (!revoked) {
      throw new SessionNotFoundError(`session ${sessionId} not found`);
    }

    // Revocation is a row update plus a cache clear; the next validate fails
    // from Postgres regardless of Redis state, forcing the full ceremony.
    await this.store.clear(sessionId);
    await this.events.publish({
      topic: 'session.revoked',
      key: sessionId,
      payload: { sessionId, consumerId },
      correlationId: sessionId,
    });
  }

  private mintToken(): string {
    return `xsess_${randomBytes(32).toString('base64url')}`;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private dayStamp(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
}
