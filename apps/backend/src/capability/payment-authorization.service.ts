import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { paymentAttempts } from '../db/schema';
import { EVENT_PUBLISHER } from '../events/event-publisher.interface';
import type { EventPublisher } from '../events/event-publisher.interface';
import { PaymentIntentService } from '../payment/payment-intent.service';
import {
  AttemptInFlightError,
  IntentExpiredError,
  IntentStateConflictError,
} from '../payment/payment.errors';
import { SessionService } from '../session/session.service';
import { CapacityService } from './capacity.service';
import { LiveIntentOnSimulatedPathError } from './capability.errors';

/** Postgres unique-violation SQLSTATE, surfaced by node-postgres. */
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/**
 * Exactly one of consumerId / sessionToken must be provided: consumerId for
 * the first-payment ceremony, sessionToken for the one-tap repeat path.
 */
export interface AuthorizeParams {
  intentId: string;
  consumerId?: string;
  sessionToken?: string;
}

export interface AuthorizeResult {
  intentId: string;
  attemptId: string;
  status: 'authorized';
  /** Present only on the session path; the fresh token after rotate-on-use. */
  rotatedSessionToken?: string;
}

/**
 * The keystone authorization path: atomic capacity reservation, conditional
 * created -> authorized transition, guarded attempt insert, and the
 * payment.authorized event, in that order. A valid Session
 * lets a repeat Payment skip the ceremony, but every Payment still passes the
 * live capacity check; the session's own velocity caps gate first and the
 * token rotates only after the authorization succeeds. Settlement is not here.
 */
@Injectable()
export class PaymentAuthorizationService {
  private readonly logger = new Logger(PaymentAuthorizationService.name);

  constructor(
    private readonly db: DbService,
    private readonly capacity: CapacityService,
    private readonly intents: PaymentIntentService,
    private readonly sessions: SessionService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  /**
   * The test-mode counterpart of {@link authorize}: the same intent
   * transition, attempt row and payment.authorized event, with no capacity
   * reservation and no Session velocity, because a sandbox Payment spends
   * nothing. Refuses a live intent outright so a real Payment can never be
   * authorized without the caps being consulted.
   */
  async authorizeSimulated(params: {
    intentId: string;
    consumerId: string;
  }): Promise<AuthorizeResult> {
    const { intentId, consumerId } = params;
    const intent = await this.intents.findById(intentId);
    if (intent.mode !== 'test') {
      throw new LiveIntentOnSimulatedPathError(
        `intent ${intentId} is live and cannot take the simulated path`,
      );
    }
    if (intent.status !== 'created') {
      throw new IntentStateConflictError(
        `intent ${intentId} is ${intent.status}, not authorizable`,
      );
    }
    if (intent.expiresAt.getTime() < Date.now()) {
      await this.intents.transition(intentId, 'created', 'expired');
      await this.events.publish({
        topic: 'payment.expired',
        key: intentId,
        payload: { intentId },
        correlationId: intentId,
      });
      throw new IntentExpiredError(`intent ${intentId} expired`);
    }

    await this.intents.transition(intentId, 'created', 'authorized', {
      consumerId,
      authorizedAt: new Date(),
    });
    const attemptId = await this.insertAttempt(intentId);

    await this.events.publish({
      topic: 'payment.authorized',
      key: intentId,
      payload: {
        intentId,
        consumerId,
        merchantId: intent.merchantId,
        usdcSettlementRaw: intent.usdcSettlementRaw,
        attemptId,
        simulated: true,
      },
      correlationId: intentId,
    });
    this.logger.log(
      `payment.authorize intent_id=${intentId} consumer_id=${consumerId} amount_raw=${intent.usdcSettlementRaw} attempt_id=${attemptId} simulated=true`,
    );
    return { intentId, attemptId, status: 'authorized' };
  }

  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    const { intentId, sessionToken } = params;
    if (Boolean(params.consumerId) === Boolean(sessionToken)) {
      // A programmer error, not a domain condition: upstream callers control
      // which path they take.
      throw new Error(
        'authorize requires exactly one of consumerId or sessionToken',
      );
    }

    const intent = await this.intents.findById(intentId);

    if (intent.status !== 'created') {
      throw new IntentStateConflictError(
        `intent ${intentId} is ${intent.status}, not authorizable`,
      );
    }
    if (intent.expiresAt.getTime() < Date.now()) {
      await this.intents.transition(intentId, 'created', 'expired');
      await this.events.publish({
        topic: 'payment.expired',
        key: intentId,
        payload: { intentId },
        correlationId: intentId,
      });
      throw new IntentExpiredError(`intent ${intentId} expired`);
    }

    // Session path: validate, then GATE (read-only) on the session's own
    // velocity caps BEFORE capacity, so the narrower gate runs first and a
    // velocity rejection never consumes tier headroom. The slot is recorded
    // only after the authorization commits (below).
    let session: { id: string; consumerId: string } | undefined;
    let consumerId: string;
    if (sessionToken) {
      session = await this.sessions.validate(sessionToken, intent.merchantId);
      consumerId = session.consumerId;
      await this.sessions.checkVelocity(session.id, intent.usdcSettlementRaw);
    } else {
      consumerId = params.consumerId as string;
    }

    // Reserve capacity BEFORE the authorizing transition. Reserving first means
    // a counter-write failure throws while the intent is still `created` (clean
    // and retryable) instead of leaving it authorized-but-uncounted, which would
    // let the amount bypass the daily/monthly caps. The reservation is atomic
    // against the caps, so two concurrent authorizations cannot both pass.
    await this.capacity.reserveCapacity(consumerId, intent.usdcSettlementRaw);

    // The conditional transition is the race arbiter; a lost race gives the
    // reservation back so the loser's amount is not held against the caps.
    try {
      await this.intents.transition(intentId, 'created', 'authorized', {
        consumerId,
        authorizedAt: new Date(),
      });
    } catch (err) {
      await this.capacity.releaseCapacity(consumerId, intent.usdcSettlementRaw);
      throw err;
    }

    const attemptId = await this.insertAttempt(intentId);

    // Record velocity + rotate only after the authorization has committed: a
    // rejected Payment must neither burn a session's daily slot nor invalidate
    // the Consumer's working token.
    let rotatedSessionToken: string | undefined;
    if (session) {
      await this.sessions.recordVelocity(session.id, intent.usdcSettlementRaw);
      rotatedSessionToken = await this.sessions.rotate(session.id);
    }

    await this.events.publish({
      topic: 'payment.authorized',
      key: intentId,
      payload: {
        intentId,
        consumerId,
        merchantId: intent.merchantId,
        usdcSettlementRaw: intent.usdcSettlementRaw,
        attemptId,
      },
      correlationId: intentId,
    });

    this.logger.log(
      `payment.authorize intent_id=${intentId} consumer_id=${consumerId} amount_raw=${intent.usdcSettlementRaw} attempt_id=${attemptId}`,
    );

    return {
      intentId,
      attemptId,
      status: 'authorized',
      ...(rotatedSessionToken ? { rotatedSessionToken } : {}),
    };
  }

  private async insertAttempt(intentId: string): Promise<string> {
    try {
      const [attempt] = await this.db.client
        .insert(paymentAttempts)
        .values({ intentId, status: 'authorized' })
        .returning({ id: paymentAttempts.id });
      return attempt.id;
    } catch (err) {
      // Defense-in-depth behind the transition: the payment_attempts partial
      // unique index is the last word on one-live-attempt.
      if (pgErrorCode(err) === '23505') {
        throw new AttemptInFlightError(
          `intent ${intentId} already has a live attempt`,
        );
      }
      throw err;
    }
  }
}
