import type { DbService } from '../db/db.service';
import type {
  EventPublisher,
  PlatformEvent,
} from '../events/event-publisher.interface';
import { paymentIntents } from '../db/schema';
import type { CapacityService } from './capacity.service';
import type { PaymentIntentService } from '../payment/payment-intent.service';
import { IntentStateConflictError } from '../payment/payment.errors';
import type { SessionService } from '../session/session.service';
import { CapacityExceededError } from './capability.errors';
import {
  SessionInvalidError,
  SessionVelocityExceededError,
} from '../session/session.errors';
import { PaymentAuthorizationService } from './payment-authorization.service';

type IntentRow = typeof paymentIntents.$inferSelect;

function intentRow(over: Partial<IntentRow> = {}): IntentRow {
  return {
    id: 'pi_1',
    merchantId: 'm1',
    consumerId: null,
    status: 'created',
    usdcSettlementRaw: '2000000',
    displayCurrency: 'USD',
    displayAmountMinor: '1000',
    fxRate: null,
    fxSource: null,
    fxQuotedAt: null,
    merchantReference: null,
    idempotencyKey: null,
    mode: 'test',
    returnUrl: null,
    cancelUrl: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    authorizedAt: null,
    approvalDeferredAt: null,
    metadata: null,
    openerOrigin: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

/** A node-postgres-shaped error: an Error instance carrying a SQLSTATE code. */
function pgError(code: string): Error {
  return Object.assign(new Error(`pg error ${code}`), { code });
}

function makeDb(opts: { attemptId?: string; insertError?: Error } = {}) {
  const insertValues = jest.fn();
  const client = {
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v);
        return {
          returning: () =>
            opts.insertError
              ? Promise.reject(opts.insertError)
              : Promise.resolve([{ id: opts.attemptId ?? 'att_1' }]),
        };
      },
    }),
  };
  return { db: { client } as unknown as DbService, insertValues };
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
  const reserveCapacity = jest.fn().mockResolvedValue(undefined);
  const releaseCapacity = jest.fn().mockResolvedValue(undefined);
  const capacity = {
    reserveCapacity,
    releaseCapacity,
  } as unknown as CapacityService;
  return { capacity, reserveCapacity, releaseCapacity };
}

function makeIntents(intent: IntentRow) {
  const findById = jest.fn().mockResolvedValue(intent);
  const transition = jest.fn().mockResolvedValue(intent);
  const intents = { findById, transition } as unknown as PaymentIntentService;
  return { intents, findById, transition };
}

function makeSessions(opts: { consumerId?: string; rotated?: string } = {}) {
  const validate = jest
    .fn()
    .mockResolvedValue({ id: 'sess1', consumerId: opts.consumerId ?? 'c1' });
  const checkVelocity = jest.fn().mockResolvedValue(undefined);
  const recordVelocity = jest.fn().mockResolvedValue(undefined);
  const rotate = jest.fn().mockResolvedValue(opts.rotated ?? 'xsess_rotated');
  const sessions = {
    validate,
    checkVelocity,
    recordVelocity,
    rotate,
  } as unknown as SessionService;
  return { sessions, validate, checkVelocity, recordVelocity, rotate };
}

describe('PaymentAuthorizationService.authorize (consumer path)', () => {
  it('authorizes and returns no rotated token, making no session calls', async () => {
    const intent = intentRow({ usdcSettlementRaw: '2000000' });
    const { intents, transition } = makeIntents(intent);
    const { capacity, reserveCapacity, releaseCapacity } = makeCapacity();
    const { sessions, validate } = makeSessions();
    const { publisher, events } = makePublisher();
    const { db } = makeDb({ attemptId: 'att_9' });
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
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
    expect(result.rotatedSessionToken).toBeUndefined();
    expect(validate).not.toHaveBeenCalled();
    expect(reserveCapacity).toHaveBeenCalledWith('c1', '2000000');
    expect(transition).toHaveBeenCalledWith(
      'pi_1',
      'created',
      'authorized',
      expect.objectContaining({ consumerId: 'c1' }),
    );
    expect(releaseCapacity).not.toHaveBeenCalled();
    expect(events[0].topic).toBe('payment.authorized');
  });

  it('propagates a capacity rejection and never transitions', async () => {
    const { intents, transition } = makeIntents(intentRow());
    const { capacity, reserveCapacity } = makeCapacity();
    reserveCapacity.mockRejectedValue(
      new CapacityExceededError('PER_PAYMENT_CAP', 'too big'),
    );
    const { sessions } = makeSessions();
    const { publisher, events } = makePublisher();
    const { db } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
    expect(transition).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('gives the reservation back when the authorizing transition loses its race', async () => {
    const intent = intentRow({ usdcSettlementRaw: '2000000' });
    const { intents, transition } = makeIntents(intent);
    transition.mockRejectedValue(new IntentStateConflictError('lost race'));
    const { capacity, reserveCapacity, releaseCapacity } = makeCapacity();
    const { sessions } = makeSessions();
    const { publisher, events } = makePublisher();
    const { db, insertValues } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toBeInstanceOf(IntentStateConflictError);

    expect(reserveCapacity).toHaveBeenCalledWith('c1', '2000000');
    expect(releaseCapacity).toHaveBeenCalledWith('c1', '2000000');
    expect(insertValues).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });
  it('maps a 23505 on the attempt insert to ATTEMPT_IN_FLIGHT', async () => {
    const { intents } = makeIntents(intentRow());
    const { capacity } = makeCapacity();
    const { sessions } = makeSessions();
    const { publisher } = makePublisher();
    const { db } = makeDb({ insertError: pgError('23505') });
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toMatchObject({ code: 'ATTEMPT_IN_FLIGHT' });
  });

  it('expires a past-TTL intent, publishes payment.expired, throws INTENT_EXPIRED', async () => {
    const { intents, transition } = makeIntents(
      intentRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const { capacity, reserveCapacity } = makeCapacity();
    const { sessions } = makeSessions();
    const { publisher, events } = makePublisher();
    const { db } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toMatchObject({ code: 'INTENT_EXPIRED' });
    expect(transition).toHaveBeenCalledWith('pi_1', 'created', 'expired');
    expect(events[0].topic).toBe('payment.expired');
    expect(reserveCapacity).not.toHaveBeenCalled();
  });

  it('rejects a non-created intent with INTENT_STATE_CONFLICT', async () => {
    const { intents } = makeIntents(intentRow({ status: 'authorized' }));
    const { capacity } = makeCapacity();
    const { sessions } = makeSessions();
    const { publisher } = makePublisher();
    const { db } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toMatchObject({ code: 'INTENT_STATE_CONFLICT' });
  });
});

describe('PaymentAuthorizationService.authorize (session path)', () => {
  it('resolves the Consumer from the session and returns the rotated token', async () => {
    const intent = intentRow({
      merchantId: 'm1',
      usdcSettlementRaw: '2000000',
    });
    const { intents, transition } = makeIntents(intent);
    const { capacity, reserveCapacity, releaseCapacity } = makeCapacity();
    const { sessions, validate, rotate } = makeSessions({
      consumerId: 'c_session',
      rotated: 'xsess_fresh',
    });
    const { publisher, events } = makePublisher();
    const { db } = makeDb({ attemptId: 'att_1' });
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    const result = await service.authorize({
      intentId: 'pi_1',
      sessionToken: 'tok',
    });

    expect(validate).toHaveBeenCalledWith('tok', 'm1');
    expect(reserveCapacity).toHaveBeenCalledWith('c_session', '2000000');
    expect(transition).toHaveBeenCalledWith(
      'pi_1',
      'created',
      'authorized',
      expect.objectContaining({ consumerId: 'c_session' }),
    );
    expect(releaseCapacity).not.toHaveBeenCalled();
    expect(rotate).toHaveBeenCalledWith('sess1');
    expect(result.rotatedSessionToken).toBe('xsess_fresh');
    expect(events[0].payload.consumerId).toBe('c_session');
  });

  it('gates session velocity before the capacity check', async () => {
    const { intents } = makeIntents(intentRow());
    const { capacity, reserveCapacity } = makeCapacity();
    const { sessions, checkVelocity } = makeSessions();
    const { publisher } = makePublisher();
    const { db } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await service.authorize({ intentId: 'pi_1', sessionToken: 'tok' });

    expect(checkVelocity.mock.invocationCallOrder[0]).toBeLessThan(
      reserveCapacity.mock.invocationCallOrder[0],
    );
  });

  it('propagates SESSION_INVALID with no transition and no attempt insert', async () => {
    const { intents, transition } = makeIntents(intentRow());
    const { capacity, reserveCapacity } = makeCapacity();
    const { sessions, validate } = makeSessions();
    validate.mockRejectedValue(new SessionInvalidError('nope'));
    const { publisher } = makePublisher();
    const { db, insertValues } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', sessionToken: 'tok' }),
    ).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    expect(reserveCapacity).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('propagates SESSION_VELOCITY_EXCEEDED before capacity is consulted', async () => {
    const { intents } = makeIntents(intentRow());
    const { capacity, reserveCapacity } = makeCapacity();
    const { sessions, checkVelocity } = makeSessions();
    checkVelocity.mockRejectedValue(
      new SessionVelocityExceededError('too fast'),
    );
    const { publisher } = makePublisher();
    const { db } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', sessionToken: 'tok' }),
    ).rejects.toMatchObject({ code: 'SESSION_VELOCITY_EXCEEDED' });
    expect(reserveCapacity).not.toHaveBeenCalled();
  });

  it('reserves capacity before the authorizing transition', async () => {
    const { intents, transition } = makeIntents(intentRow());
    const { capacity, reserveCapacity } = makeCapacity();
    const { sessions } = makeSessions();
    const { publisher } = makePublisher();
    const { db } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await service.authorize({ intentId: 'pi_1', sessionToken: 'tok' });

    expect(reserveCapacity.mock.invocationCallOrder[0]).toBeLessThan(
      transition.mock.invocationCallOrder[0],
    );
  });

  it('leaves the intent unauthorized and retryable if the capacity reserve fails', async () => {
    const { intents, transition } = makeIntents(intentRow());
    const { capacity, reserveCapacity } = makeCapacity();
    reserveCapacity.mockRejectedValue(new Error('counter store down'));
    const { sessions, recordVelocity } = makeSessions();
    const { publisher } = makePublisher();
    const { db, insertValues } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await expect(
      service.authorize({ intentId: 'pi_1', sessionToken: 'tok' }),
    ).rejects.toThrow('counter store down');
    // Reserve failed before the transition: intent stays created (retryable),
    // never authorized-but-uncounted, and no session slot is burned.
    expect(transition).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
    expect(recordVelocity).not.toHaveBeenCalled();
  });

  it('records session velocity only after the attempt commits', async () => {
    const { intents } = makeIntents(intentRow());
    const { capacity } = makeCapacity();
    const { sessions, recordVelocity } = makeSessions();
    const { publisher } = makePublisher();
    const { db, insertValues } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await service.authorize({ intentId: 'pi_1', sessionToken: 'tok' });

    expect(recordVelocity).toHaveBeenCalledWith('sess1', '2000000');
    expect(recordVelocity.mock.invocationCallOrder[0]).toBeGreaterThan(
      insertValues.mock.invocationCallOrder[0],
    );
  });
});

describe('PaymentAuthorizationService.authorize (argument validation)', () => {
  function service() {
    const { intents } = makeIntents(intentRow());
    const { capacity } = makeCapacity();
    const { sessions } = makeSessions();
    const { publisher } = makePublisher();
    const { db } = makeDb();
    return new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );
  }

  it('throws when both consumerId and sessionToken are provided', async () => {
    await expect(
      service().authorize({
        intentId: 'pi_1',
        consumerId: 'c1',
        sessionToken: 'tok',
      }),
    ).rejects.toThrow(/exactly one/);
  });

  it('throws when neither consumerId nor sessionToken is provided', async () => {
    await expect(service().authorize({ intentId: 'pi_1' })).rejects.toThrow(
      /exactly one/,
    );
  });
});

describe('PaymentAuthorizationService.authorizeSimulated (test mode)', () => {
  it('transitions, records the attempt and publishes without touching capacity or sessions', async () => {
    const { intents, transition } = makeIntents(intentRow({ mode: 'test' }));
    const { capacity, reserveCapacity, releaseCapacity } = makeCapacity();
    const { sessions, validate, checkVelocity, recordVelocity, rotate } =
      makeSessions();
    const { publisher, events } = makePublisher();
    const { db, insertValues } = makeDb({ attemptId: 'att_sim' });
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    const result = await service.authorizeSimulated({
      intentId: 'pi_1',
      consumerId: 'c1',
    });

    expect(result).toEqual({
      intentId: 'pi_1',
      attemptId: 'att_sim',
      status: 'authorized',
    });
    expect(reserveCapacity).not.toHaveBeenCalled();
    expect(releaseCapacity).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(checkVelocity).not.toHaveBeenCalled();
    expect(recordVelocity).not.toHaveBeenCalled();
    expect(rotate).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith(
      'pi_1',
      'created',
      'authorized',
      expect.objectContaining({ consumerId: 'c1' }),
    );
    expect(insertValues).toHaveBeenCalledWith({
      intentId: 'pi_1',
      status: 'authorized',
    });
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('payment.authorized');
    expect(events[0].payload).toMatchObject({ simulated: true });
  });

  it('refuses a live intent before anything is written, so a live key can never take the simulated path', async () => {
    const { intents, transition } = makeIntents(intentRow({ mode: 'live' }));
    const { capacity, reserveCapacity } = makeCapacity();
    const { sessions } = makeSessions();
    const { publisher, events } = makePublisher();
    const { db, insertValues } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );

    await expect(
      service.authorizeSimulated({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toMatchObject({ code: 'LIVE_INTENT_ON_SIMULATED_PATH' });
    expect(transition).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
    expect(reserveCapacity).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('still refuses an intent that is not created or has expired', async () => {
    const { intents } = makeIntents(
      intentRow({ mode: 'test', status: 'authorized' }),
    );
    const { capacity } = makeCapacity();
    const { sessions } = makeSessions();
    const { publisher } = makePublisher();
    const { db } = makeDb();
    const service = new PaymentAuthorizationService(
      db,
      capacity,
      intents,
      sessions,
      publisher,
    );
    await expect(
      service.authorizeSimulated({ intentId: 'pi_1', consumerId: 'c1' }),
    ).rejects.toBeInstanceOf(IntentStateConflictError);
  });
});
