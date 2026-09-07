import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../../../db/db.service';
import type {
  EventPublisher,
  PlatformEvent,
} from '../../../events/event-publisher.interface';
import { OfframpReconcilerService } from './offramp-reconciler.service';

const config = {
  get: (k: string) =>
    k === 'SETTLEMENT_OFFRAMP_STUCK_MINUTES' ? 120 : undefined,
} as unknown as ConfigService;

function makeDb(cfg: {
  stuck: { id: string; status: string }[];
  claims: unknown[][];
}) {
  const claims = [...cfg.claims];
  const sets: Record<string, unknown>[] = [];
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () => Promise.resolve(cfg.stuck),
  };
  const updateChain = {
    set: (v: Record<string, unknown>) => {
      sets.push(v);
      return updateChain;
    },
    where: () => updateChain,
    returning: () => Promise.resolve(claims.shift() ?? []),
  };
  const client = {
    select: () => selectChain,
    update: () => updateChain,
  };
  return { db: { client } as unknown as DbService, sets };
}

/**
 * One row whose status the conditional writes actually move, so "still
 * selectable on the next run" is observed rather than scripted.
 */
function makeStatefulDb(initial: {
  id: string;
  status: string;
  failureReason: string | null;
  updatedAt: Date;
  merchantId: string;
  paymentId: string | null;
}) {
  const row = { ...initial };
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () =>
      Promise.resolve(
        row.status === 'pending' || row.status === 'converting'
          ? [{ ...row }]
          : [],
      ),
  };
  const updateChain = {
    set: (v: Record<string, unknown>) => {
      Object.assign(row, v);
      return updateChain;
    },
    where: () => updateChain,
    returning: () =>
      Promise.resolve([
        { id: row.id, merchantId: row.merchantId, paymentId: row.paymentId },
      ]),
  };
  const client = {
    select: () => selectChain,
    update: () => updateChain,
  };
  return { db: { client } as unknown as DbService, row };
}

function makePublisher() {
  const events: PlatformEvent[] = [];
  const publish = jest.fn((e: PlatformEvent) => {
    events.push(e);
    return Promise.resolve();
  });
  return { publisher: { publish } as EventPublisher, events };
}

describe('OfframpReconcilerService.tick', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('fails a silent off-ramp with OFFRAMP_TIMEOUT and publishes payout.failed', async () => {
    const { db, sets } = makeDb({
      stuck: [{ id: 'so_1', status: 'pending' }],
      claims: [[{ id: 'so_1', merchantId: 'm_1', paymentId: 'pay_1' }]],
    });
    const { publisher, events } = makePublisher();

    await new OfframpReconcilerService(db, config, publisher).tick();

    expect(sets[0]).toMatchObject({ status: 'failed' });
    expect(sets[0].failureReason).toContain('OFFRAMP_TIMEOUT');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      topic: 'payout.failed',
      key: 'so_1',
      payload: { offrampId: 'so_1', paymentId: 'pay_1' },
    });
  });

  it('publishes nothing for a row a webhook resolved between select and claim', async () => {
    const { db } = makeDb({
      stuck: [{ id: 'so_2', status: 'converting' }],
      claims: [[]],
    });
    const { publisher, events } = makePublisher();

    await new OfframpReconcilerService(db, config, publisher).tick();

    expect(events).toHaveLength(0);
  });

  it('leaves the row selectable when the publish throws, and the next run emits exactly one event', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const selectedAt = new Date('2026-01-01T00:00:00.000Z');
    const { db, row } = makeStatefulDb({
      id: 'so_3',
      status: 'pending',
      failureReason: null,
      updatedAt: selectedAt,
      merchantId: 'm_1',
      paymentId: 'pay_1',
    });
    const events: PlatformEvent[] = [];
    let brokerDown = true;
    const publisher = {
      publish: jest.fn((e: PlatformEvent) => {
        if (brokerDown) return Promise.reject(new Error('broker unreachable'));
        events.push(e);
        return Promise.resolve();
      }),
    } as EventPublisher;
    const service = new OfframpReconcilerService(db, config, publisher);

    await service.tick();

    // The failed write is undone, timestamp included, so the stale window
    // still holds and the row comes back on the next select.
    expect(events).toHaveLength(0);
    expect(row.status).toBe('pending');
    expect(row.failureReason).toBeNull();
    expect(row.updatedAt).toEqual(selectedAt);

    brokerDown = false;
    await service.tick();

    expect(row.status).toBe('failed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      topic: 'payout.failed',
      key: 'so_3',
      payload: { offrampId: 'so_3', reason: 'OFFRAMP_TIMEOUT' },
    });

    // A third run finds nothing: the terminal event fires once per off-ramp.
    await service.tick();
    expect(events).toHaveLength(1);
  });
});
