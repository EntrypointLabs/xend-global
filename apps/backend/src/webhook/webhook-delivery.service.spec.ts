import { promises as dns } from 'node:dns';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import { webhookDeliveries, webhookEndpoints } from '../db/schema';
import { WebhookDeliveryService } from './webhook-delivery.service';

type EndpointRow = typeof webhookEndpoints.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

function endpointRow(over: Partial<EndpointRow> = {}): EndpointRow {
  return {
    id: 'we1',
    merchantId: 'm1',
    url: 'https://merchant.example.com/hook',
    secretPrimary: 'whsec_primary',
    secretSecondary: null,
    enabled: true,
    eventTypes: null,
    mode: 'test',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function deliveryRow(over: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: 'wd1',
    endpointId: 'we1',
    eventId: 'evt_1',
    eventType: 'payment.succeeded',
    payload: JSON.stringify({ id: 'evt_1' }),
    correlationId: 'pi_1',
    attemptNo: 1,
    responseStatus: null,
    responseBody: null,
    durationMs: null,
    status: 'pending',
    origin: 'event',
    nextRetryAt: null,
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

function makeConfig(over: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    WEBHOOK_DELIVERY_TIMEOUT_MS: 10000,
    WEBHOOK_RESPONSE_BODY_MAX: 2048,
    WEBHOOK_MAX_ATTEMPTS: 12,
    WEBHOOK_RETRY_BASE_SECONDS: 30,
    WEBHOOK_RETRY_MAX_SECONDS: 21600,
    WEBHOOK_ALLOW_PRIVATE_URLS: true,
    ...over,
  };
  return {
    get: (k: string) => values[k],
    getOrThrow: (k: string) => {
      if (!(k in values)) throw new Error(`missing ${k}`);
      return values[k];
    },
  } as unknown as ConfigService;
}

function makeDb(endpoint: EndpointRow | null) {
  const updates: Record<string, unknown>[] = [];
  const selectChain = (rows: unknown[]) => ({
    where: () => ({ limit: () => Promise.resolve(rows) }),
  });
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        if (tbl === webhookEndpoints)
          return selectChain(endpoint ? [endpoint] : []);
        throw new Error('unknown table');
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { db: { client } as unknown as DbService, updates };
}

describe('WebhookDeliveryService.attempt', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockFetch(impl: () => Promise<unknown>) {
    return jest
      .spyOn(global, 'fetch')
      .mockImplementation(impl as unknown as typeof fetch);
  }

  it('marks a 2xx delivery succeeded', async () => {
    const { db, updates } = makeDb(endpointRow());
    mockFetch(() =>
      Promise.resolve({ status: 200, text: () => Promise.resolve('ok') }),
    );
    const service = new WebhookDeliveryService(db, makeConfig());
    await service.attempt(deliveryRow());
    expect(updates[0]).toMatchObject({
      status: 'succeeded',
      responseStatus: 200,
    });
  });

  it('marks a 500 delivery failed with a future next_retry_at', async () => {
    const { db, updates } = makeDb(endpointRow());
    mockFetch(() =>
      Promise.resolve({ status: 500, text: () => Promise.resolve('err') }),
    );
    const service = new WebhookDeliveryService(db, makeConfig());
    await service.attempt(deliveryRow({ attemptNo: 1 }));
    expect(updates[0]).toMatchObject({ status: 'failed', responseStatus: 500 });
    expect((updates[0].nextRetryAt as Date).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('marks the delivery exhausted at the attempt cap', async () => {
    const { db, updates } = makeDb(endpointRow());
    mockFetch(() =>
      Promise.resolve({ status: 500, text: () => Promise.resolve('err') }),
    );
    const service = new WebhookDeliveryService(
      db,
      makeConfig({ WEBHOOK_MAX_ATTEMPTS: 3 }),
    );
    await service.attempt(deliveryRow({ attemptNo: 3 }));
    expect(updates[0]).toMatchObject({ status: 'exhausted' });
    expect(updates[0].nextRetryAt).toBeNull();
  });

  it('marks failed when a redirect makes fetch reject under redirect:error', async () => {
    const { db, updates } = makeDb(endpointRow());
    const fetchSpy = mockFetch(() =>
      Promise.reject(new Error('redirect not allowed')),
    );
    const service = new WebhookDeliveryService(db, makeConfig());
    await service.attempt(deliveryRow());
    expect(fetchSpy).toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: 'failed' });
  });

  it('marks failed without any fetch when the SSRF guard rejects', async () => {
    const { db, updates } = makeDb(endpointRow());
    const fetchSpy = mockFetch(() =>
      Promise.resolve({ status: 200, text: () => Promise.resolve('') }),
    );
    const lookupSpy = jest.spyOn(dns, 'lookup') as unknown as jest.Mock;
    lookupSpy.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const service = new WebhookDeliveryService(
      db,
      makeConfig({ WEBHOOK_ALLOW_PRIVATE_URLS: false }),
    );
    await service.attempt(deliveryRow());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: 'failed' });
  });

  it('truncates the recorded response body to the cap', async () => {
    const { db, updates } = makeDb(endpointRow());
    mockFetch(() =>
      Promise.resolve({
        status: 200,
        text: () => Promise.resolve('x'.repeat(100)),
      }),
    );
    const service = new WebhookDeliveryService(
      db,
      makeConfig({ WEBHOOK_RESPONSE_BODY_MAX: 5 }),
    );
    await service.attempt(deliveryRow());
    expect((updates[0].responseBody as string).length).toBe(5);
  });
});
