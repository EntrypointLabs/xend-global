import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import {
  paymentIntents,
  payments,
  settlementAccounts,
  webhookEndpoints,
} from '../db/schema';
import type { EventConsumer } from '../events/event-consumer.interface';
import type { PlatformEvent } from '../events/event-publisher.interface';
import type { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { buildEventId } from './webhook-events';

type IntentRow = typeof paymentIntents.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type EndpointRow = typeof webhookEndpoints.$inferSelect;
type AccountRow = typeof settlementAccounts.$inferSelect;

function intentRow(over: Partial<IntentRow> = {}): IntentRow {
  return {
    id: 'pi_1',
    merchantId: 'm1',
    consumerId: 'c1',
    status: 'succeeded',
    usdcSettlementRaw: '1000000',
    ngnDisplayMinor: null,
    fxRate: null,
    fxSource: null,
    fxQuotedAt: null,
    merchantReference: 'order-9',
    idempotencyKey: null,
    mode: 'test',
    returnUrl: null,
    cancelUrl: null,
    expiresAt: new Date('2026-01-01'),
    authorizedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function paymentRow(): PaymentRow {
  return {
    id: 'pay_1',
    intentId: 'pi_1',
    merchantId: 'm1',
    consumerId: 'c1',
    usdcSettlementRaw: '1000000',
    ngnDisplayMinor: null,
    txSignature: 'sig123',
    settledAt: new Date('2026-01-02'),
    refundOfPaymentId: null,
    createdAt: new Date('2026-01-02'),
  };
}

function accountRow(): AccountRow {
  return {
    id: 'sa1',
    merchantId: 'm1',
    address: 'Addr',
    provider: 'direct_usdc',
    currency: 'USDC',
    providerReference: 'ref-1',
    payoutConfig: null,
    authorityAddress: null,
    provisionedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function endpointRow(over: Partial<EndpointRow> = {}): EndpointRow {
  return {
    id: 'we1',
    merchantId: 'm1',
    url: 'https://merchant.example.com/hook',
    secretPrimary: 'whsec_p',
    secretSecondary: null,
    enabled: true,
    eventTypes: null,
    mode: 'test',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

/** A thenable that also carries .limit(), so both `.where().limit()` and a
 *  directly-awaited `.where()` work against the same fake. */
function whereResult(rows: unknown[]) {
  const p = Promise.resolve(rows);
  return Object.assign(p, { limit: () => Promise.resolve(rows) });
}

function makeDb(cfg: {
  intent?: IntentRow | null;
  payment?: PaymentRow | null;
  account?: AccountRow | null;
  endpoints?: EndpointRow[];
}) {
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        let rows: unknown[] = [];
        if (tbl === paymentIntents) rows = cfg.intent ? [cfg.intent] : [];
        else if (tbl === payments) rows = cfg.payment ? [cfg.payment] : [];
        else if (tbl === settlementAccounts)
          rows = cfg.account ? [cfg.account] : [];
        else if (tbl === webhookEndpoints) rows = cfg.endpoints ?? [];
        else throw new Error('unknown table');
        return { where: () => whereResult(rows) };
      },
    }),
  };
  return { client } as unknown as DbService;
}

function makeDelivery(createReturns: unknown) {
  return {
    createDelivery: jest.fn().mockResolvedValue(createReturns),
    attempt: jest.fn().mockResolvedValue(undefined),
  } as unknown as WebhookDeliveryService & {
    createDelivery: jest.Mock;
    attempt: jest.Mock;
  };
}

const consumer = { subscribe: jest.fn() } as unknown as EventConsumer;
const config = {
  getOrThrow: () => 'webhook-dispatcher',
} as unknown as ConfigService;

function event(over: Partial<PlatformEvent> = {}): PlatformEvent {
  return {
    topic: 'payment.succeeded',
    key: 'pi_1',
    payload: {},
    correlationId: 'pi_1',
    ...over,
  };
}

describe('WebhookDispatcherService.handle', () => {
  it('materializes one delivery per matching endpoint with the deterministic event id and attempts it', async () => {
    const db = makeDb({
      intent: intentRow(),
      payment: paymentRow(),
      account: accountRow(),
      endpoints: [endpointRow()],
    });
    const delivery = makeDelivery({ id: 'wd1' });
    const svc = new WebhookDispatcherService(consumer, db, delivery, config);

    await svc.handle(event());

    expect(delivery.createDelivery).toHaveBeenCalledTimes(1);
    const calls = delivery.createDelivery.mock.calls as Array<
      [{ eventId: string; origin: string; payload: string }]
    >;
    const call = calls[0][0];
    expect(call.eventId).toBe(buildEventId('payment.succeeded', 'pi_1'));
    expect(call.origin).toBe('event');
    const parsed = JSON.parse(call.payload) as {
      livemode: boolean;
      data: { object: { settlement: { provider: string } } };
    };
    expect(parsed.livemode).toBe(false);
    expect(parsed.data.object.settlement.provider).toBe('direct_usdc');
    expect(delivery.attempt).toHaveBeenCalledTimes(1);
  });

  it('does not attempt when the delivery already exists (re-consume)', async () => {
    const db = makeDb({
      intent: intentRow(),
      payment: paymentRow(),
      account: accountRow(),
      endpoints: [endpointRow()],
    });
    const delivery = makeDelivery(null); // ON CONFLICT DO NOTHING -> null
    const svc = new WebhookDispatcherService(consumer, db, delivery, config);
    await svc.handle(event());
    expect(delivery.createDelivery).toHaveBeenCalledTimes(1);
    expect(delivery.attempt).not.toHaveBeenCalled();
  });

  it('skips an endpoint whose event_types exclude the type', async () => {
    const db = makeDb({
      intent: intentRow(),
      payment: paymentRow(),
      account: accountRow(),
      endpoints: [endpointRow({ eventTypes: ['payment.failed'] })],
    });
    const delivery = makeDelivery({ id: 'wd1' });
    const svc = new WebhookDispatcherService(consumer, db, delivery, config);
    await svc.handle(event());
    expect(delivery.createDelivery).not.toHaveBeenCalled();
  });

  it('creates no delivery when no endpoint matches the mode (empty set)', async () => {
    const db = makeDb({
      intent: intentRow({ mode: 'live' }),
      payment: paymentRow(),
      account: accountRow(),
      endpoints: [], // the mode filter removed the test endpoint
    });
    const delivery = makeDelivery({ id: 'wd1' });
    const svc = new WebhookDispatcherService(consumer, db, delivery, config);
    await svc.handle(event());
    expect(delivery.createDelivery).not.toHaveBeenCalled();
  });

  it('throws when a succeeded event has no committed payments row (Kafka redelivers)', async () => {
    const db = makeDb({
      intent: intentRow(),
      payment: null,
      account: accountRow(),
      endpoints: [endpointRow()],
    });
    const delivery = makeDelivery({ id: 'wd1' });
    const svc = new WebhookDispatcherService(consumer, db, delivery, config);
    await expect(svc.handle(event())).rejects.toThrow(/not yet committed/);
  });

  it('materializes an expired event without requiring a payments row', async () => {
    const db = makeDb({
      intent: intentRow({ status: 'expired' }),
      payment: null,
      account: accountRow(),
      endpoints: [endpointRow()],
    });
    const delivery = makeDelivery({ id: 'wd1' });
    const svc = new WebhookDispatcherService(consumer, db, delivery, config);
    await svc.handle(event({ topic: 'payment.expired' }));
    expect(delivery.createDelivery).toHaveBeenCalledTimes(1);
    expect(delivery.attempt).toHaveBeenCalledTimes(1);
  });
});
