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
});
