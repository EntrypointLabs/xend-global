import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
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
    displayCurrency: 'USD',
    displayAmountMinor: '1000',
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
    approvalDeferredAt: null,
    metadata: null,
    openerOrigin: null,
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
    displayCurrency: 'USD',
    displayAmountMinor: '1000',
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
    secondaryExpiresAt: null,
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

  it('logs and skips a succeeded event with no payments row instead of stalling the partition', async () => {
    const db = makeDb({
      intent: intentRow(),
      payment: null,
      account: accountRow(),
      endpoints: [endpointRow()],
    });
    const delivery = makeDelivery({ id: 'wd1' });
    const svc = new WebhookDispatcherService(consumer, db, delivery, config);
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await expect(svc.handle(event())).resolves.toBeUndefined();
    expect(delivery.createDelivery).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('payment_absent'),
    );
    errorSpy.mockRestore();
  });

  it('materializes a failed event without a payments row (failure writes none)', async () => {
    const db = makeDb({
      intent: intentRow({ status: 'failed' }),
      payment: null,
      account: accountRow(),
      endpoints: [endpointRow()],
    });
    const delivery = makeDelivery({ id: 'wd1' });
    const svc = new WebhookDispatcherService(consumer, db, delivery, config);
    await svc.handle(event({ topic: 'payment.failed' }));
    expect(delivery.createDelivery).toHaveBeenCalledTimes(1);
    expect(delivery.attempt).toHaveBeenCalledTimes(1);
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

describe('WebhookDispatcherService.handle (test mode)', () => {
  /** Captures the endpoint query's WHERE so the mode scoping is asserted on the SQL, not on the fake. */
  function makeCapturingDb(intent: IntentRow, endpoints: EndpointRow[]) {
    const captured: { where?: SQL } = {};
    const client = {
      select: () => ({
        from: (tbl: unknown) => ({
          where: (cond: SQL) => {
            let rows: unknown[] = [];
            if (tbl === paymentIntents) rows = [intent];
            else if (tbl === payments) rows = [paymentRow()];
            else if (tbl === settlementAccounts) rows = [accountRow()];
            else if (tbl === webhookEndpoints) {
              captured.where = cond;
              rows = endpoints;
            }
            return whereResult(rows);
          },
        }),
      }),
    };
    return { db: { client } as unknown as DbService, captured };
  }

  it('selects only endpoints registered under the intent mode and marks the event livemode=false', async () => {
    const { db, captured } = makeCapturingDb(intentRow({ mode: 'test' }), [
      endpointRow({ mode: 'test' }),
    ]);
    const delivery = makeDelivery({ id: 'wd1' });
    const svc = new WebhookDispatcherService(consumer, db, delivery, config);

    await svc.handle(event());

    const query = new PgDialect().sqlToQuery(captured.where as SQL);
    expect(query.sql).toContain('"mode"');
    expect(query.params).toContain('test');
    expect(query.params).not.toContain('live');
    const calls = delivery.createDelivery.mock.calls as Array<
      [{ payload: string }]
    >;
    expect(JSON.parse(calls[0][0].payload)).toMatchObject({ livemode: false });
  });

  it('asks for live endpoints, and only live endpoints, for a live intent', async () => {
    const { db, captured } = makeCapturingDb(intentRow({ mode: 'live' }), []);
    const delivery = makeDelivery({ id: 'wd1' });
    const svc = new WebhookDispatcherService(consumer, db, delivery, config);

    await svc.handle(event());

    const query = new PgDialect().sqlToQuery(captured.where as SQL);
    expect(query.params).toContain('live');
    expect(query.params).not.toContain('test');
    expect(delivery.createDelivery).not.toHaveBeenCalled();
  });
});
