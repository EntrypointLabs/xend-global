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
    const svc = new WebhookRetryService(db, delivery);

    await svc.tick();

    expect(delivery.attempt).toHaveBeenCalledTimes(2);
    // The claim sets status back to pending under the guard.
    expect(setCaptures[0]).toMatchObject({ status: 'pending' });
    expect(setCaptures[0].attemptNo).toBeDefined();
  });

  it('does not attempt a row it fails to claim (lost the status-guarded race)', async () => {
    const d1 = deliveryRow({ id: 'd1' });
    const { db } = makeDb({
      due: [d1],
      claims: [[]], // rowCount 0: another sweep already claimed it
      reloads: [],
    });
    const delivery = makeDelivery();
    const svc = new WebhookRetryService(db, delivery);

    await svc.tick();

    expect(delivery.attempt).not.toHaveBeenCalled();
  });
});
