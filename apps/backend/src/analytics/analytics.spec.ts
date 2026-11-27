import {
  AnalyticsEventPublisher,
  mapPlatformEvent,
} from './analytics-event-publisher';
import { createPostHogLogger } from './posthog-logger';
import {
  bucketAmount,
  bucketNgnMinor,
  bucketUsdcRaw,
  reasonCode,
  redactLogLine,
} from './redact';
import type { ServerAnalytics } from './server-analytics.service';

const SIGNATURE =
  '5VfYmGC6bSPb4Qxk3BzR7xYH2nM8kZpL1qWcTeuA9dJsN4rFvXy6oHgE3iKtUwbLmQ';

describe('mapPlatformEvent', () => {
  it('keeps ids and a bucket, and drops signatures and exact amounts', () => {
    const mapped = mapPlatformEvent({
      topic: 'payment.succeeded',
      key: 'intent-1',
      payload: {
        intentId: 'intent-1',
        paymentId: 'pay-1',
        merchantId: 'm-1',
        consumerId: 'c-1',
        usdcSettlementRaw: '25000000',
        signature: SIGNATURE,
        providerTxRef: 'PAJ-123',
      },
    });
    expect(mapped).toEqual({
      event: 'server_payment_succeeded',
      subject: { consumerId: 'c-1' },
      props: {
        merchant_id: 'm-1',
        intent_id: 'intent-1',
        payment_id: 'pay-1',
        amount_bucket: '10-50',
        rail: 'usdc',
      },
    });
    expect(JSON.stringify(mapped)).not.toContain(SIGNATURE);
    expect(JSON.stringify(mapped)).not.toContain('25000000');
  });

  it('attributes merchant-only events to the merchant', () => {
    expect(
      mapPlatformEvent({
        topic: 'payout.completed',
        key: 'o-1',
        payload: {
          merchantId: 'm-1',
          paymentId: 'p',
          ngnSettledMinor: '2000000',
        },
      }),
    ).toMatchObject({
      subject: { merchantId: 'm-1' },
      props: { amount_bucket: '10k-50k', currency: 'NGN' },
    });
  });

  it('keeps events with only an intent id personless', () => {
    expect(
      mapPlatformEvent({
        topic: 'payment.expired',
        key: 'i-9',
        payload: { intentId: 'i-9' },
      })?.subject,
    ).toEqual({ anonymous: 'intent:i-9' });
  });

  it('ignores unknown topics', () => {
    expect(
      mapPlatformEvent({ topic: 'something.else', key: 'k', payload: {} }),
    ).toBeNull();
  });
});

describe('AnalyticsEventPublisher', () => {
  const analytics = (enabled: boolean) =>
    ({ enabled, capture: jest.fn() }) as unknown as ServerAnalytics & {
      capture: jest.Mock;
    };

  it('publishes first, then captures', async () => {
    const inner = { publish: jest.fn().mockResolvedValue(undefined) };
    const a = analytics(true);
    const publisher = new AnalyticsEventPublisher(inner, a);
    const event = {
      topic: 'payment.expired',
      key: 'i',
      payload: { intentId: 'i' },
    };
    await publisher.publish(event);
    expect(inner.publish).toHaveBeenCalledWith(event);
    expect(a.capture).toHaveBeenCalledWith(
      'server_payment_expired',
      { anonymous: 'intent:i' },
      { intent_id: 'i', merchant_id: undefined },
    );
  });

  it('does not capture when the publish fails', async () => {
    const inner = { publish: jest.fn().mockRejectedValue(new Error('down')) };
    const a = analytics(true);
    await expect(
      new AnalyticsEventPublisher(inner, a).publish({
        topic: 'payment.expired',
        key: 'i',
        payload: {},
      }),
    ).rejects.toThrow('down');
    expect(a.capture).not.toHaveBeenCalled();
  });

  it('forwards lifecycle hooks so a Kafka producer still connects', async () => {
    const inner = {
      publish: jest.fn(),
      onModuleInit: jest.fn(),
      onApplicationShutdown: jest.fn(),
    };
    const publisher = new AnalyticsEventPublisher(inner, analytics(false));
    await publisher.onModuleInit();
    await publisher.onApplicationShutdown('SIGTERM');
    expect(inner.onModuleInit).toHaveBeenCalled();
    expect(inner.onApplicationShutdown).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('redact', () => {
  // Same expectations as packages/analytics' spec: the ladders must agree.
  it('uses the same ladders as the apps', () => {
    expect(bucketAmount(0)).toBe('0');
    expect(bucketAmount(0.5)).toBe('<1');
    expect(bucketAmount(25)).toBe('10-50');
    expect(bucketAmount(2_500)).toBe('1k-5k');
    expect(bucketAmount(50_000)).toBe('10k+');
    expect(bucketAmount(20_000, 'NGN')).toBe('10k-50k');
    expect(bucketAmount(-1)).toBeUndefined();
  });

  it('converts base units before bucketing', () => {
    expect(bucketUsdcRaw('1500000')).toBe('1-10');
    expect(bucketNgnMinor(2_000_000n)).toBe('10k-50k');
    expect(bucketUsdcRaw(null)).toBeUndefined();
  });

  it('masks personal data in log lines and keeps on-chain ids', () => {
    const line = redactLogLine(
      `user ada@example.com bvn=22212345678 acct 0123456789 Authorization: Bearer abc.def token=xyz sig=${SIGNATURE} jwt eyJhbGc.eyJzdWIi.sig`,
    );
    expect(line).not.toMatch(
      /ada@example\.com|22212345678|0123456789|abc\.def|xyz|eyJhbGc/,
    );
    expect(line).toContain(SIGNATURE);
  });

  it('turns errors into short codes', () => {
    expect(reasonCode('OFFRAMP_TIMEOUT')).toBe('offramp_timeout');
    expect(reasonCode('insufficient funds for rent')).toBe('insufficient');
    expect(reasonCode({ status: 502 })).toBe('http_502');
    expect(reasonCode(SIGNATURE)).toBe('error');
    expect(reasonCode(undefined)).toBe('unknown');
  });
});

describe('createPostHogLogger', () => {
  it('stays off without a key or when the level is off', () => {
    expect(createPostHogLogger({})).toBeNull();
    expect(
      createPostHogLogger({ POSTHOG_KEY: 'phc_x', POSTHOG_LOGS_LEVEL: 'off' }),
    ).toBeNull();
  });

  it('ships only lines at or above the level, redacted', () => {
    const logger = createPostHogLogger({
      POSTHOG_KEY: 'phc_x',
      POSTHOG_LOGS_LEVEL: 'warn',
    });
    expect(logger).not.toBeNull();
    const emit = jest.fn();
    (logger as unknown as { otel: { emit: jest.Mock } }).otel = { emit };
    logger!.setLogLevels([]);
    logger!.log('info line', 'Ctx');
    logger!.warn('mail to ada@example.com bounced', 'MailService');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityText: 'WARN',
        body: 'mail to [email] bounced',
        attributes: { 'log.context': 'MailService' },
      }),
    );
  });
});
