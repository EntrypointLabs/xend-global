import type { DbService } from '../db/db.service';
import type {
  EventPublisher,
  PlatformEvent,
} from '../events/event-publisher.interface';
import { paymentIntents } from '../db/schema';
import type { CapacityService } from './capacity.service';
import type { PaymentIntentService } from '../payment/payment-intent.service';
import { CapacityExceededError } from './capability.errors';
import { PaymentAuthorizationService } from './payment-authorization.service';

type IntentRow = typeof paymentIntents.$inferSelect;

function intentRow(over: Partial<IntentRow> = {}): IntentRow {
  return {
    id: 'pi_1',
    merchantId: 'm1',
    consumerId: null,
    status: 'created',
    usdcSettlementRaw: '2000000',
    ngnDisplayMinor: null,
    fxRate: null,
    fxSource: null,
    fxQuotedAt: null,
    merchantReference: null,
    idempotencyKey: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    authorizedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

/** A node-postgres-shaped error: an Error instance carrying a SQLSTATE code. */
function pgError(code: string): Error {
  return Object.assign(new Error(`pg error ${code}`), { code });
}

function makeDb(opts: { attemptId?: string; insertError?: Error }): DbService {
  const client = {
    insert: () => ({
      values: () => ({
        returning: () => {
          if (opts.insertError) return Promise.reject(opts.insertError);
          return Promise.resolve([{ id: opts.attemptId ?? 'att_1' }]);
        },
      }),
    }),
  };
  return { client } as unknown as DbService;
}

function makePublisher() {
  const events: PlatformEvent[] = [];
  const publisher = {
    publish: (e: PlatformEvent) => {
      events.push(e);
      return Promise.resolve();
    },
  } as EventPublisher;
  return { publisher, events };
}

function makeCapacity() {
  const checkCapacity = jest.fn().mockResolvedValue(undefined);
  const recordAuthorizedPayment = jest.fn().mockResolvedValue(undefined);
  const capacity = {
    checkCapacity,
    recordAuthorizedPayment,
  } as unknown as CapacityService;
  return { capacity, checkCapacity, recordAuthorizedPayment };
}

function makeIntents(intent: IntentRow) {
  const findById = jest.fn().mockResolvedValue(intent);
  const transition = jest.fn().mockResolvedValue(intent);
  const intents = { findById, transition } as unknown as PaymentIntentService;
  return { intents, findById, transition };
}

describe('PaymentAuthorizationService.authorize', () => {
  it('runs capacity, transition, attempt insert, counters, then payment.authorized', async () => {
    const intent = intentRow({
      id: 'pi_1',
      merchantId: 'm1',
      usdcSettlementRaw: '2000000',
    });
    const { intents, transition } = makeIntents(intent);
    const { capacity, checkCapacity, recordAuthorizedPayment } = makeCapacity();
    const { publisher, events } = makePublisher();
    const db = makeDb({ attemptId: 'att_9' });
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      publisher,
    );

    const result = await service.authorize({
      intentId: 'pi_1',
      consumerId: 'c1',
    });

    expect(result).toEqual({
      intentId: 'pi_1',
      attemptId: 'att_9',
      status: 'authorized',
    });
    expect(checkCapacity).toHaveBeenCalledWith('c1', '2000000');
    expect(transition).toHaveBeenCalledWith(
      'pi_1',
      'created',
      'authorized',
      expect.objectContaining({ consumerId: 'c1' }),
    );
    expect(recordAuthorizedPayment).toHaveBeenCalledWith('c1', '2000000');
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('payment.authorized');
    expect(events[0].key).toBe('pi_1');
    expect(events[0].correlationId).toBe('pi_1');
    expect(events[0].payload.attemptId).toBe('att_9');
  });

  it('propagates a capacity rejection and never transitions', async () => {
    const intent = intentRow();
    const { intents, transition } = makeIntents(intent);
    const { capacity, checkCapacity } = makeCapacity();
    checkCapacity.mockRejectedValue(
      new CapacityExceededError('PER_PAYMENT_CAP', 'too big'),
    );
    const { publisher, events } = makePublisher();
    const service = new PaymentAuthorizationService(
      makeDb({}),
      capacity,
      intents,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
    expect(transition).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('maps a 23505 on the attempt insert to ATTEMPT_IN_FLIGHT', async () => {
    const intent = intentRow();
    const { intents } = makeIntents(intent);
    const { capacity } = makeCapacity();
    const { publisher } = makePublisher();
    const service = new PaymentAuthorizationService(
      makeDb({ insertError: pgError('23505') }),
      capacity,
      intents,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_IN_FLIGHT' });
  });

  it('expires a past-TTL intent, publishes payment.expired, throws INTENT_EXPIRED', async () => {
    const intent = intentRow({ expiresAt: new Date(Date.now() - 1000) });
    const { intents, transition } = makeIntents(intent);
    const { capacity, checkCapacity } = makeCapacity();
    const { publisher, events } = makePublisher();
    const service = new PaymentAuthorizationService(
      makeDb({}),
      capacity,
      intents,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toMatchObject({ code: 'INTENT_EXPIRED' });
    expect(transition).toHaveBeenCalledWith('pi_1', 'created', 'expired');
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('payment.expired');
    expect(checkCapacity).not.toHaveBeenCalled();
  });

  it('rejects a non-created intent with INTENT_STATE_CONFLICT', async () => {
    const intent = intentRow({ status: 'authorized' });
    const { intents } = makeIntents(intent);
    const { capacity } = makeCapacity();
    const { publisher } = makePublisher();
    const service = new PaymentAuthorizationService(
      makeDb({}),
      capacity,
      intents,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toMatchObject({ code: 'INTENT_STATE_CONFLICT' });
  });
});
