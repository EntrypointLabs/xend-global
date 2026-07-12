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
import { CapacityService } from './capacity.service';

/** Postgres unique-violation SQLSTATE, surfaced by node-postgres. */
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

export interface AuthorizeParams {
  intentId: string;
  consumerId: string;
}

export interface AuthorizeResult {
  intentId: string;
  attemptId: string;
  status: 'authorized';
}

/**
 * The keystone authorization path: capacity check, conditional
 * created -> authorized transition, guarded attempt insert, counter
 * recording, and the payment.authorized event, in that order. Settlement
 * (attempt -> settling/succeeded/failed, message pinning, signature-first
 * retry) is deliberately not here; the attempt row's message and signature
 * stay null until the settlement leg fills them.
 */
@Injectable()
export class PaymentAuthorizationService {
  private readonly logger = new Logger(PaymentAuthorizationService.name);

  constructor(
    private readonly db: DbService,
    private readonly capacity: CapacityService,
    private readonly intents: PaymentIntentService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    const { intentId, consumerId } = params;
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

    // Capacity BEFORE any write, so a rejected Payment leaves the intent
    // untouched.
    await this.capacity.checkCapacity(consumerId, intent.usdcSettlementRaw);

    // The conditional transition is the race arbiter.
    await this.intents.transition(intentId, 'created', 'authorized', {
      consumerId,
      authorizedAt: new Date(),
    });

    let attemptId: string;
    try {
      const [attempt] = await this.db.client
        .insert(paymentAttempts)
        .values({ intentId, status: 'authorized' })
        .returning({ id: paymentAttempts.id });
      attemptId = attempt.id;
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

    await this.capacity.recordAuthorizedPayment(
      consumerId,
      intent.usdcSettlementRaw,
    );

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

    return { intentId, attemptId, status: 'authorized' };
  }
}
