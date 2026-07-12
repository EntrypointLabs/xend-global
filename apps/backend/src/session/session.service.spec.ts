import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import type {
  EventPublisher,
  PlatformEvent,
} from '../events/event-publisher.interface';
import type {
  CounterSnapshot,
  RateCounter,
} from '../counters/rate-counter.interface';
import type { SessionStore } from './session-store.interface';
import { sessions } from '../db/schema';
import { SessionService } from './session.service';

type SessionRow = typeof sessions.$inferSelect;

const DAY = 24 * 60 * 60 * 1000;

function sessionRow(over: Partial<SessionRow> = {}): SessionRow {
  const now = new Date();
  return {
    id: 's1',
    tokenHash: 'hash',
    consumerId: 'c1',
    merchantId: 'm1',
    issuingIntentId: null,
    uaHint: null,
    lastUsedAt: now,
    expiresAt: new Date(Date.now() + 90 * DAY),
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

interface ListRow {
  id: string;
  merchantDisplayName: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
}

function makeFakeDb(cfg: {
  sessionSelects?: SessionRow[][];
  insertId?: string;
  sessionUpdates?: { id: string }[][];
  listRows?: ListRow[];
}) {
  const sessionSelects = [...(cfg.sessionSelects ?? [])];
  const sessionUpdates = [...(cfg.sessionUpdates ?? [])];
  const inserts: Record<string, unknown>[] = [];

  const client = {
    select: (projection?: unknown) => ({
      from: () => {
        if (projection) {
          const jchain = {
            innerJoin: () => jchain,
            where: () => Promise.resolve(cfg.listRows ?? []),
          };
          return jchain;
        }
        const rows = sessionSelects.shift() ?? [];
        const chain = {
          where: () => chain,
          limit: () => Promise.resolve(rows),
        };
        return chain;
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return {
          returning: () => Promise.resolve([{ id: cfg.insertId ?? 's_new' }]),
        };
      },
    }),
    update: () => {
      const chain = {
        set: () => chain,
        where: () => chain,
        returning: () => Promise.resolve(sessionUpdates.shift() ?? []),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve([]).then(res, rej),
      };
      return chain;
    },
  };
  return { db: { client } as unknown as DbService, inserts };
}

function makeConfig(over: Record<string, string | number> = {}): ConfigService {
  const values: Record<string, string | number> = {
    SESSION_ABSOLUTE_TTL_DAYS: 90,
    SESSION_SLIDING_WINDOW_DAYS: 30,
    SESSION_VELOCITY_MAX_PAYMENTS_PER_DAY: 5,
    SESSION_VELOCITY_MAX_AMOUNT_RAW_PER_DAY: '100000000',
    CAPACITY_TIERS:
      '{"tier0":{"perPaymentMaxRaw":"50000000","dailyCapRaw":"200000000","monthlyCapRaw":"1000000000"}}',
    ...over,
  };
  return {
    getOrThrow: (key: string): string | number => {
      const v = values[key];
      if (v === undefined) throw new Error(`missing config ${key}`);
      return v;
    },
  } as unknown as ConfigService;
}

function makeStore(active = true) {
  const touch = jest.fn().mockResolvedValue(undefined);
  const isActive = jest.fn().mockResolvedValue(active);
  const clear = jest.fn().mockResolvedValue(undefined);
  const store = { touch, isActive, clear } as unknown as SessionStore;
  return { store, touch, isActive, clear };
}

function makeCounter(peek: CounterSnapshot = { count: 0, totalRaw: '0' }) {
  const increments: { key: string; amountRaw: string }[] = [];
  const counter = {
    peek: jest.fn().mockResolvedValue(peek),
    increment: jest.fn((key: string, amountRaw: string) => {
      increments.push({ key, amountRaw });
      return Promise.resolve({ count: 1, totalRaw: amountRaw });
    }),
    clear: jest.fn(),
  } as unknown as RateCounter;
  return { counter, increments };
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

describe('SessionService.onModuleInit', () => {
  it('boots with velocity caps at or below the smallest tier daily cap', () => {
    const { db } = makeFakeDb({});
    const { store } = makeStore();
    const { counter } = makeCounter();
    const { publisher } = makePublisher();
    const service = new SessionService(
      db,
      makeConfig(),
      store,
      counter,
      publisher,
    );
    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('refuses to boot when the velocity amount cap exceeds the smallest tier daily cap', () => {
    const { db } = makeFakeDb({});
    const { store } = makeStore();
    const { counter } = makeCounter();
    const { publisher } = makePublisher();
    const service = new SessionService(
      db,
      makeConfig({ SESSION_VELOCITY_MAX_AMOUNT_RAW_PER_DAY: '300000000' }),
      store,
      counter,
      publisher,
    );
    expect(() => service.onModuleInit()).toThrow(/at or below/);
  });
});

function makeService(opts: {
  db: DbService;
  config?: ConfigService;
  active?: boolean;
  peek?: CounterSnapshot;
}) {
  const { store, touch, isActive, clear } = makeStore(opts.active ?? true);
  const { counter, increments } = makeCounter(opts.peek);
  const { publisher, events } = makePublisher();
  const service = new SessionService(
    opts.db,
    opts.config ?? makeConfig(),
    store,
    counter,
    publisher,
  );
  service.onModuleInit();
  return { service, touch, isActive, clear, increments, events };
}

describe('SessionService.issue', () => {
  it('mints an opaque xsess_ token, stores only its hash, and publishes session.issued', async () => {
    const { db, inserts } = makeFakeDb({ insertId: 's_issued' });
    const { service, touch, events } = makeService({ db });

    const result = await service.issue({ consumerId: 'c1', merchantId: 'm1' });

    expect(result.sessionId).toBe('s_issued');
    expect(result.token.startsWith('xsess_')).toBe(true);
    // Hash at rest: the stored value is the SHA-256 of the token, never the
    // raw token itself.
    const expectedHash = createHash('sha256')
      .update(result.token)
      .digest('hex');
    expect(inserts[0].tokenHash).toBe(expectedHash);
    expect(inserts[0].tokenHash).not.toBe(result.token);
    expect(touch).toHaveBeenCalledWith('s_issued', 30 * 24 * 60 * 60);
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('session.issued');
  });
});

describe('SessionService.validate', () => {
  it('accepts a live session on the Redis hot path', async () => {
    const { db } = makeFakeDb({ sessionSelects: [[sessionRow()]] });
    const { service } = makeService({ db, active: true });
    const row = await service.validate('token', 'm1');
    expect(row.id).toBe('s1');
  });

  it('accepts a session on the Postgres fallback when Redis misses but last_used_at is fresh', async () => {
    const { db } = makeFakeDb({
      sessionSelects: [
        [sessionRow({ lastUsedAt: new Date(Date.now() - DAY) })],
      ],
    });
    const { service } = makeService({ db, active: false });
    const row = await service.validate('token', 'm1');
    expect(row.id).toBe('s1');
  });

  it('rejects a revoked session with SESSION_INVALID', async () => {
    const { db } = makeFakeDb({
      sessionSelects: [[sessionRow({ revokedAt: new Date() })]],
    });
    const { service } = makeService({ db });
    await expect(service.validate('token', 'm1')).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });

  it('rejects an absolute-expired session with SESSION_INVALID', async () => {
    const { db } = makeFakeDb({
      sessionSelects: [
        [sessionRow({ expiresAt: new Date(Date.now() - 1000) })],
      ],
    });
    const { service } = makeService({ db });
    await expect(service.validate('token', 'm1')).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });

  it('rejects an idle session (Redis miss and last_used_at past the window)', async () => {
    const { db } = makeFakeDb({
      sessionSelects: [
        [sessionRow({ lastUsedAt: new Date(Date.now() - 31 * DAY) })],
      ],
    });
    const { service } = makeService({ db, active: false });
    await expect(service.validate('token', 'm1')).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });

  it('rejects a merchant mismatch with SESSION_INVALID', async () => {
    const { db } = makeFakeDb({ sessionSelects: [[sessionRow()]] });
    const { service } = makeService({ db });
    await expect(service.validate('token', 'other')).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });
});

describe('SessionService.rotate', () => {
  it('returns a fresh token when the session is rotatable', async () => {
    const { db } = makeFakeDb({ sessionUpdates: [[{ id: 's1' }]] });
    const { service } = makeService({ db });
    const token = await service.rotate('s1');
    expect(token.startsWith('xsess_')).toBe(true);
  });

  it('throws SESSION_INVALID when the session is revoked (no row updated)', async () => {
    const { db } = makeFakeDb({ sessionUpdates: [[]] });
    const { service } = makeService({ db });
    await expect(service.rotate('s1')).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });
});

describe('SessionService.checkAndRecordVelocity', () => {
  it('records a payment within the caps', async () => {
    const { db } = makeFakeDb({});
    const { service, increments } = makeService({
      db,
      peek: { count: 0, totalRaw: '0' },
    });
    await service.checkAndRecordVelocity('s1', '1000000');
    expect(increments).toHaveLength(1);
    expect(increments[0].amountRaw).toBe('1000000');
  });

  it('rejects when the payment-count cap is reached', async () => {
    const { db } = makeFakeDb({});
    const { service } = makeService({
      db,
      peek: { count: 5, totalRaw: '0' },
    });
    await expect(
      service.checkAndRecordVelocity('s1', '1000000'),
    ).rejects.toMatchObject({ code: 'SESSION_VELOCITY_EXCEEDED' });
  });

  it('rejects when the amount cap would be exceeded', async () => {
    const { db } = makeFakeDb({});
    const { service } = makeService({
      db,
      peek: { count: 0, totalRaw: '99000000' },
    });
    await expect(
      service.checkAndRecordVelocity('s1', '2000000'),
    ).rejects.toMatchObject({ code: 'SESSION_VELOCITY_EXCEEDED' });
  });
});

describe('SessionService.listForConsumer', () => {
  it('maps rows to summaries with ISO strings and no token hash', async () => {
    const { db } = makeFakeDb({
      listRows: [
        {
          id: 's1',
          merchantDisplayName: 'Acme Store',
          createdAt: new Date('2026-01-01'),
          lastUsedAt: new Date('2026-01-02'),
          expiresAt: new Date('2026-04-01'),
        },
      ],
    });
    const { service } = makeService({ db });

    const summaries = await service.listForConsumer('c1');

    expect(summaries).toHaveLength(1);
    expect(summaries[0].merchantDisplayName).toBe('Acme Store');
    expect(summaries[0].createdAt).toBe(new Date('2026-01-01').toISOString());
    expect(summaries[0]).not.toHaveProperty('tokenHash');
  });
});

describe('SessionService.revoke', () => {
  it('revokes an owned session, clears the store, and publishes session.revoked', async () => {
    const { db } = makeFakeDb({ sessionUpdates: [[{ id: 's1' }]] });
    const { service, clear, events } = makeService({ db });

    await service.revoke('c1', 's1');

    expect(clear).toHaveBeenCalledWith('s1');
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('session.revoked');
    expect(events[0].correlationId).toBe('s1');
  });

  it('throws SESSION_NOT_FOUND for a non-owned or absent session', async () => {
    const { db } = makeFakeDb({ sessionUpdates: [[]] });
    const { service } = makeService({ db });
    await expect(service.revoke('c1', 'ghost')).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });
});
