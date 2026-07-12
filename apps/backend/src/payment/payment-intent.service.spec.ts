import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import type {
  EventPublisher,
  PlatformEvent,
} from '../events/event-publisher.interface';
import { merchants, paymentIntents } from '../db/schema';
import { PaymentIntentService } from './payment-intent.service';

type MerchantRow = typeof merchants.$inferSelect;
type IntentRow = typeof paymentIntents.$inferSelect;

function merchantRow(over: Partial<MerchantRow> = {}): MerchantRow {
  return {
    id: 'm1',
    name: 'Acme',
    displayName: 'Acme Store',
    status: 'active',
    intentTtlMinutes: null,
    allowedOrigins: null,
    kybStatus: 'pending',
    kybVerifiedAt: null,
    flatFeeBps: 0,
    fxSpreadBps: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function intentRow(over: Partial<IntentRow> = {}): IntentRow {
  return {
    id: 'pi_1',
    merchantId: 'm1',
    consumerId: null,
    status: 'created',
    usdcSettlementRaw: '1000000',
    ngnDisplayMinor: null,
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
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

interface FakeDbConfig {
  merchants?: MerchantRow[];
  intentSelects?: IntentRow[][];
  intentUpdates?: Partial<IntentRow>[][];
  intentInsert?: IntentRow;
  intentInsertError?: Error;
}

/** A node-postgres-shaped error: an Error instance carrying a SQLSTATE code. */
function pgError(code: string): Error {
  return Object.assign(new Error(`pg error ${code}`), { code });
}

function makeFakeDb(cfg: FakeDbConfig): DbService {
  const merchantRows = cfg.merchants ?? [];
  const intentSelects = [...(cfg.intentSelects ?? [])];
  const intentUpdates = [...(cfg.intentUpdates ?? [])];

  const selectChain = (rows: unknown[]) => {
    const chain = {
      where: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain;
  };

  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        if (tbl === merchants) return selectChain(merchantRows);
        if (tbl === paymentIntents)
          return selectChain(intentSelects.shift() ?? []);
        throw new Error('unknown table in fake select');
      },
    }),
    insert: () => ({
      values: () => ({
        returning: () => {
          if (cfg.intentInsertError)
            return Promise.reject(cfg.intentInsertError);
          return Promise.resolve(cfg.intentInsert ? [cfg.intentInsert] : []);
        },
      }),
    }),
    update: () => {
      const chain = {
        set: () => chain,
        where: () => chain,
        returning: () => Promise.resolve(intentUpdates.shift() ?? []),
      };
      return chain;
    },
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

const config = { getOrThrow: () => 60 } as unknown as ConfigService;

describe('PaymentIntentService.create', () => {
  it('publishes payment.created with the intent id as key and correlation id', async () => {
    const intent = intentRow({ id: 'pi_abc' });
    const db = makeFakeDb({ merchants: [merchantRow()], intentInsert: intent });
    const { publisher, events } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);

    const result = await service.create({
      merchantId: 'm1',
      usdcSettlementRaw: '1000000',
    });

    expect(result.id).toBe('pi_abc');
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('payment.created');
    expect(events[0].key).toBe('pi_abc');
    expect(events[0].correlationId).toBe('pi_abc');
    expect(events[0].payload.intentId).toBe('pi_abc');
  });

  it('returns the existing intent on idempotency replay and publishes nothing', async () => {
    const existing = intentRow({ id: 'pi_existing', idempotencyKey: 'idem-1' });
    const db = makeFakeDb({
      merchants: [merchantRow()],
      intentSelects: [[existing]],
    });
    const { publisher, events } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);

    const result = await service.create({
      merchantId: 'm1',
      usdcSettlementRaw: '1000000',
      idempotencyKey: 'idem-1',
    });

    expect(result.id).toBe('pi_existing');
    expect(events).toHaveLength(0);
  });

  it('rejects an unknown merchant', async () => {
    const db = makeFakeDb({ merchants: [] });
    const { publisher } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);
    await expect(
      service.create({ merchantId: 'ghost', usdcSettlementRaw: '1000000' }),
    ).rejects.toMatchObject({ code: 'MERCHANT_NOT_FOUND' });
  });

  it('rejects a suspended merchant', async () => {
    const db = makeFakeDb({
      merchants: [merchantRow({ status: 'suspended' })],
    });
    const { publisher } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);
    await expect(
      service.create({ merchantId: 'm1', usdcSettlementRaw: '1000000' }),
    ).rejects.toMatchObject({ code: 'MERCHANT_SUSPENDED' });
  });

  it('rejects a non-positive amount', async () => {
    const db = makeFakeDb({ merchants: [merchantRow()] });
    const { publisher } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);
    await expect(
      service.create({ merchantId: 'm1', usdcSettlementRaw: '0' }),
    ).rejects.toThrow(/positive integer/);
  });

  it('returns the race winner when the idempotency insert hits a 23505', async () => {
    const winner = intentRow({ id: 'pi_winner', idempotencyKey: 'idem-1' });
    const db = makeFakeDb({
      merchants: [merchantRow()],
      // First select: idempotency pre-check misses. Second select: the
      // post-race re-read returns the winning intent.
      intentSelects: [[], [winner]],
      intentInsertError: pgError('23505'),
    });
    const { publisher, events } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);

    const result = await service.create({
      merchantId: 'm1',
      usdcSettlementRaw: '1000000',
      idempotencyKey: 'idem-1',
    });

    expect(result.id).toBe('pi_winner');
    expect(events).toHaveLength(0);
  });
});

describe('PaymentIntentService.transition', () => {
  it('returns the updated row when the expected status matches', async () => {
    const updated = intentRow({ status: 'authorized' });
    const db = makeFakeDb({ intentUpdates: [[updated]] });
    const { publisher } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);
    const row = await service.transition('pi_1', 'created', 'authorized');
    expect(row.status).toBe('authorized');
  });

  it('throws INTENT_STATE_CONFLICT and writes nothing on a stale expected status', async () => {
    const db = makeFakeDb({
      intentUpdates: [[]],
      intentSelects: [[intentRow({ status: 'authorized' })]],
    });
    const { publisher } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);
    await expect(
      service.transition('pi_1', 'created', 'authorized'),
    ).rejects.toMatchObject({ code: 'INTENT_STATE_CONFLICT' });
  });

  it('throws INTENT_NOT_FOUND when the intent is absent', async () => {
    const db = makeFakeDb({ intentUpdates: [[]], intentSelects: [[]] });
    const { publisher } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);
    await expect(
      service.transition('pi_x', 'created', 'authorized'),
    ).rejects.toMatchObject({ code: 'INTENT_NOT_FOUND' });
  });
});

describe('PaymentIntentService.expireStale', () => {
  it('publishes one payment.expired per expired intent, keyed by intent id', async () => {
    const db = makeFakeDb({
      intentUpdates: [[{ id: 'pi_1' }, { id: 'pi_2' }]],
    });
    const { publisher, events } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);

    await service.expireStale();

    expect(events).toHaveLength(2);
    expect(events[0].topic).toBe('payment.expired');
    expect(events[0].correlationId).toBe('pi_1');
    expect(events[1].correlationId).toBe('pi_2');
  });

  it('publishes nothing when no intents are stale', async () => {
    const db = makeFakeDb({ intentUpdates: [[]] });
    const { publisher, events } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);
    await service.expireStale();
    expect(events).toHaveLength(0);
  });
});

describe('PaymentIntentService.findById', () => {
  it('throws INTENT_NOT_FOUND for an absent intent', async () => {
    const db = makeFakeDb({ intentSelects: [[]] });
    const { publisher } = makePublisher();
    const service = new PaymentIntentService(db, config, publisher);
    await expect(service.findById('pi_x')).rejects.toMatchObject({
      code: 'INTENT_NOT_FOUND',
    });
  });
});
