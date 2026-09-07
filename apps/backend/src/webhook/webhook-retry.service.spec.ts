import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import { webhookDeliveries } from '../db/schema';
import type { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookRetryService } from './webhook-retry.service';

type DeliveryRow = typeof webhookDeliveries.$inferSelect;

function deliveryRow(over: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: 'wd1',
    endpointId: 'we1',
    eventId: 'evt_1',
    eventType: 'payment.succeeded',
    payload: '{}',
    correlationId: 'pi_1',
    attemptNo: 1,
    responseStatus: 500,
    responseBody: 'err',
    durationMs: 10,
    status: 'failed',
    origin: 'event',
    nextRetryAt: new Date(Date.now() - 1000),
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

function makeDb(cfg: {
  due: DeliveryRow[];
  claims: { id: string }[][];
  reloads: DeliveryRow[][];
}) {
  const selectResults: unknown[][] = [cfg.due, ...cfg.reloads];
  const claimResults = [...cfg.claims];
  const setCaptures: Record<string, unknown>[] = [];

  const selectChain = {
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () => Promise.resolve(selectResults.shift() ?? []),
  };
  const updateChain = {
    set: (v: Record<string, unknown>) => {
      setCaptures.push(v);
      return updateChain;
    },
    where: () => updateChain,
    returning: () => Promise.resolve(claimResults.shift() ?? []),
  };
  const client = {
    select: () => ({ from: () => selectChain }),
    update: () => updateChain,
  };
  return { db: { client } as unknown as DbService, setCaptures };
}

const config = {
  get: (k: string) => (k === 'WEBHOOK_PENDING_STALE_MINUTES' ? 10 : undefined),
} as unknown as ConfigService;

function makeDelivery() {
  return {
    attempt: jest.fn().mockResolvedValue(undefined),
  } as unknown as WebhookDeliveryService & { attempt: jest.Mock };
}

describe('WebhookRetryService.tick', () => {
  it('claims each due failed row under the status guard and re-attempts it', async () => {
    const d1 = deliveryRow({ id: 'd1' });
    const d2 = deliveryRow({ id: 'd2' });
    const { db, setCaptures } = makeDb({
      due: [d1, d2],
      claims: [[{ id: 'd1' }], [{ id: 'd2' }]],
      reloads: [
        [deliveryRow({ id: 'd1', attemptNo: 2 })],
        [deliveryRow({ id: 'd2', attemptNo: 2 })],
      ],
    });
    const delivery = makeDelivery();
    const svc = new WebhookRetryService(db, delivery, config);

    await svc.tick();

    expect(delivery.attempt).toHaveBeenCalledTimes(2);
    // The claim sets status back to pending under the guard.
    expect(setCaptures[0]).toMatchObject({ status: 'pending' });
    expect(setCaptures[0].attemptNo).toBeDefined();
  });

  it('picks up a pending row older than the stale window and claims it without bumping the attempt', async () => {
    const stale = deliveryRow({
      id: 'p1',
      status: 'pending',
      nextRetryAt: null,
      createdAt: new Date(Date.now() - 30 * 60_000),
    });
    const { db, setCaptures } = makeDb({
      due: [stale],
      claims: [[{ id: 'p1' }]],
      reloads: [[stale]],
    });
    const delivery = makeDelivery();
    const svc = new WebhookRetryService(db, delivery, config);

    await svc.tick();

    expect(delivery.attempt).toHaveBeenCalledTimes(1);
    expect(setCaptures[0].attemptNo).toBeUndefined();
    expect(setCaptures[0].status).toBeUndefined();
    expect((setCaptures[0].nextRetryAt as Date).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('does not attempt a row it fails to claim (lost the status-guarded race)', async () => {
    const d1 = deliveryRow({ id: 'd1' });
    const { db } = makeDb({
      due: [d1],
      claims: [[]], // rowCount 0: another sweep already claimed it
      reloads: [],
    });
    const delivery = makeDelivery();
    const svc = new WebhookRetryService(db, delivery, config);

    await svc.tick();

    expect(delivery.attempt).not.toHaveBeenCalled();
  });
});
