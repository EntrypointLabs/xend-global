import { paymentIntents } from '../db/schema';
import { buildEventId, buildEventPayload } from './webhook-events';

type IntentRow = typeof paymentIntents.$inferSelect;

function intentRow(over: Partial<IntentRow> = {}): IntentRow {
  return {
    id: 'pi_1',
    merchantId: 'm1',
    consumerId: 'c1',
    status: 'succeeded',
    usdcSettlementRaw: '1000000',
    displayCurrency: 'USD',
    displayAmountMinor: '100',
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

function build(intent: IntentRow) {
  return buildEventPayload({
    eventId: buildEventId('payment.succeeded', intent.id),
    type: 'payment.succeeded',
    livemode: false,
    correlationId: intent.id,
    intent,
    payment: null,
    settlement: null,
  });
}

describe('buildEventPayload', () => {
  it('reads a USDC-priced intent back as USDC in raw units, matching the merchant API object', () => {
    const object = build(intentRow()).data.object;
    expect(object.currency).toBe('USDC');
    expect(object.amount).toBe('1000000');
    expect(object.usdc_settlement_raw).toBe('1000000');
  });

  it('leaves a naira-priced intent in its display currency and minor units', () => {
    const object = build(
      intentRow({
        displayCurrency: 'NGN',
        displayAmountMinor: '8000000',
        usdcSettlementRaw: '5000000',
      }),
    ).data.object;
    expect(object.currency).toBe('NGN');
    expect(object.amount).toBe('8000000');
  });

  it('carries merchant metadata when present and null otherwise', () => {
    expect(build(intentRow()).data.object.metadata).toBeNull();
    expect(
      build(intentRow({ metadata: { order: '42', tier: 'gold' } })).data.object
        .metadata,
    ).toEqual({ order: '42', tier: 'gold' });
  });

  it('derives a stable event id from topic and intent', () => {
    expect(buildEventId('payment.succeeded', 'pi_1')).toBe(
      buildEventId('payment.succeeded', 'pi_1'),
    );
    expect(buildEventId('payment.succeeded', 'pi_1')).not.toBe(
      buildEventId('payment.failed', 'pi_1'),
    );
  });
});
