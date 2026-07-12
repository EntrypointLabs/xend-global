/**
 * Phase 6 closing harness (the infra-free half of the devnet E2E). It drives
 * the REAL webhook dispatcher + delivery service, checkout controller, and
 * idempotency layer with the in-memory fake-DB pattern and a captured outbound
 * fetch, then asserts the frozen contracts with verifyWebhook / verifyReturnUrl:
 * correlation trace, replay idempotency, tampered-signature rejection,
 * expired-intent unpayable, the camelCase summary, the blocking authorize with
 * a signed return URL, the HttpOnly cookie, and the PAYMENT_PROCESSING timeout.
 *
 * The live-chain half (funded devnet USDC settling end to end) is the
 * human-gated task 6.8; this suite requires no Kafka/Redis/Postgres.
 *
 * Run:
 *   npx jest --config ./test/jest-e2e.json merchant-webhook
 */
import type { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createId } from '@paralleldrive/cuid2';
import {
  paymentIntents,
  payments,
  settlementAccounts,
  webhookEndpoints,
  merchants,
  idempotencyKeys,
} from '../src/db/schema';
import type { DbService } from '../src/db/db.service';
import { WebhookDeliveryService } from '../src/webhook/webhook-delivery.service';
import { WebhookDispatcherService } from '../src/webhook/webhook-dispatcher.service';
import { buildEventId } from '../src/webhook/webhook-events';
import { verifyWebhook } from '../src/webhook/webhook-signer';
import type { EventConsumer } from '../src/events/event-consumer.interface';
import type { PlatformEvent } from '../src/events/event-publisher.interface';
import { CheckoutController } from '../src/checkout/checkout.controller';
import { verifyReturnUrl } from '../src/checkout/return-url';
import { IdempotencyService } from '../src/merchant/idempotency.service';
import type { PaymentIntentService } from '../src/payment/payment-intent.service';
import type { PaymentAuthorizationService } from '../src/capability/payment-authorization.service';
import type { IdentityService } from '../src/capability/identity.service';
import type { SessionService } from '../src/session/session.service';
import { IntentExpiredError } from '../src/payment/payment.errors';

const WEBHOOK_SECRET = 'whsec_e2e_secret';
const RETURN_SECRET = 'checkout-return-secret';
const COOKIE = 'xend_checkout_session';
const TOLERANCE = 300;

// ---- shared config ----
function makeConfig(over: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    WEBHOOK_DELIVERY_TIMEOUT_MS: 5000,
    WEBHOOK_RESPONSE_BODY_MAX: 2048,
    WEBHOOK_MAX_ATTEMPTS: 12,
    WEBHOOK_RETRY_BASE_SECONDS: 30,
    WEBHOOK_RETRY_MAX_SECONDS: 21600,
    WEBHOOK_ALLOW_PRIVATE_URLS: true,
    WEBHOOK_CONSUMER_GROUP: 'webhook-dispatcher',
    CHECKOUT_SESSION_COOKIE: COOKIE,
    CHECKOUT_RETURN_URL_SECRET: RETURN_SECRET,
    CHECKOUT_RETURN_URL_TTL_SECONDS: 900,
    SESSION_ABSOLUTE_TTL_DAYS: 90,
    ...over,
  };
  return {
    get: (k: string) => values[k],
    getOrThrow: (k: string) => values[k],
  } as unknown as ConfigService;
}

// ---- rows ----
const MERCHANT_ID = 'm_e2e';
const INTENT_ID = 'pi_e2e';

function intentRow(over: Record<string, unknown> = {}) {
  return {
    id: INTENT_ID,
    merchantId: MERCHANT_ID,
    consumerId: 'c1',
    status: 'succeeded',
    usdcSettlementRaw: '1000000',
    ngnDisplayMinor: '160000',
    fxRate: '1600.00',
    fxSource: 'pilot-static',
    fxQuotedAt: new Date('2026-01-01'),
    merchantReference: 'order-1',
    idempotencyKey: null,
    mode: 'test',
    returnUrl: 'https://shop.example.com/return',
    cancelUrl: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    authorizedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function endpointRow() {
  return {
    id: 'we_e2e',
    merchantId: MERCHANT_ID,
    url: 'https://127.0.0.1/hook',
    secretPrimary: WEBHOOK_SECRET,
    secretSecondary: null,
    enabled: true,
    eventTypes: null,
    mode: 'test',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function thenable(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: () => Promise.resolve(rows),
  });
}

// A webhook-leg fake DB: serves intent/payment/account/endpoint reads and
// emulates the ON CONFLICT DO NOTHING partial index for origin='event'.
function makeWebhookDb(cfg: {
  intent?: Record<string, unknown> | null;
  payment?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  endpoints?: Record<string, unknown>[];
}) {
  const seen = new Set<string>();
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        if (tbl === paymentIntents)
          return { where: () => thenable(cfg.intent ? [cfg.intent] : []) };
        if (tbl === payments)
          return { where: () => thenable(cfg.payment ? [cfg.payment] : []) };
        if (tbl === settlementAccounts)
          return { where: () => thenable(cfg.account ? [cfg.account] : []) };
        if (tbl === webhookEndpoints)
          return { where: () => thenable(cfg.endpoints ?? []) };
        throw new Error('unknown table');
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (v.origin === 'event') {
              const k = `${String(v.endpointId)}:${String(v.eventId)}`;
              if (seen.has(k)) return Promise.resolve([]);
              seen.add(k);
            }
            return Promise.resolve([
              {
                id: createId(),
                attemptNo: 1,
                status: 'pending',
                responseStatus: null,
                responseBody: null,
                durationMs: null,
                nextRetryAt: null,
                createdAt: new Date(),
                ...v,
              },
            ]);
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  return { client } as unknown as DbService;
}

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function captureFetch(): { captured: Captured[]; restore: () => void } {
  const captured: Captured[] = [];
  const spy = jest.spyOn(global, 'fetch').mockImplementation(((
    url: string,
    init: RequestInit,
  ) => {
    captured.push({
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as string,
    });
    return Promise.resolve({
      status: 200,
      text: () => Promise.resolve('ok'),
    });
  }) as unknown as typeof fetch);
  return { captured, restore: () => spy.mockRestore() };
}

const consumer = { subscribe: jest.fn() } as unknown as EventConsumer;

function succeededEvent(): PlatformEvent {
  return {
    topic: 'payment.succeeded',
    key: INTENT_ID,
    payload: {},
    correlationId: INTENT_ID,
  };
}

describe('Phase 6 E2E harness: webhook truth', () => {
  it('traces one correlation id through the delivery and its signature verifies, and a replay is idempotent', async () => {
    const db = makeWebhookDb({
      intent: intentRow(),
      payment: { id: 'pay_1', txSignature: 'sig', settledAt: new Date() },
      account: {
        provider: 'direct_usdc',
        currency: 'USDC',
        providerReference: 'ref',
      },
      endpoints: [endpointRow()],
    });
    const config = makeConfig();
    const delivery = new WebhookDeliveryService(db, config);
    const dispatcher = new WebhookDispatcherService(
      consumer,
      db,
      delivery,
      config,
    );
    const { captured, restore } = captureFetch();
    try {
      await dispatcher.handle(succeededEvent());

      expect(captured).toHaveLength(1);
      const req = captured[0];
      const sigHeader = req.headers['Xend-Signature'];
      expect(req.headers['Xend-Event-Id']).toBe(
        buildEventId('payment.succeeded', INTENT_ID),
      );
      expect(req.headers['X-Correlation-Id']).toBe(INTENT_ID);
      expect(
        verifyWebhook(req.body, sigHeader, WEBHOOK_SECRET, TOLERANCE),
      ).toBe(true);
      const parsed = JSON.parse(req.body) as {
        id: string;
        correlation_id: string;
        data: { object: { settlement: { provider: string } } };
      };
      expect(parsed.correlation_id).toBe(INTENT_ID);
      expect(parsed.id).toBe(buildEventId('payment.succeeded', INTENT_ID));
      expect(parsed.data.object.settlement.provider).toBe('direct_usdc');

      // Replay the SAME event: the partial unique index collapses it.
      await dispatcher.handle(succeededEvent());
      expect(captured).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('rejects a tampered body and an out-of-tolerance timestamp', async () => {
    const db = makeWebhookDb({
      intent: intentRow(),
      payment: { id: 'pay_1' },
      account: {
        provider: 'direct_usdc',
        currency: 'USDC',
        providerReference: 'ref',
      },
      endpoints: [endpointRow()],
    });
    const config = makeConfig();
    const delivery = new WebhookDeliveryService(db, config);
    const dispatcher = new WebhookDispatcherService(
      consumer,
      db,
      delivery,
      config,
    );
    const { captured, restore } = captureFetch();
    try {
      await dispatcher.handle(succeededEvent());
      const { body, headers } = captured[0];
      const sig = headers['Xend-Signature'];
      // One-byte tamper.
      const tampered = body.replace(/./, body[0] === 'x' ? 'y' : 'x');
      expect(verifyWebhook(tampered, sig, WEBHOOK_SECRET, TOLERANCE)).toBe(
        false,
      );
      // Out-of-tolerance timestamp: verify far in the future.
      const parts = Object.fromEntries(
        sig.split(',').map((p) => p.split('=')),
      ) as Record<string, string>;
      const t = Number(parts.t);
      expect(
        verifyWebhook(body, sig, WEBHOOK_SECRET, TOLERANCE, t + TOLERANCE + 10),
      ).toBe(false);
    } finally {
      restore();
    }
  });

  it('materializes a webhook for an expired intent', async () => {
    const db = makeWebhookDb({
      intent: intentRow({ status: 'expired' }),
      payment: null,
      account: {
        provider: 'direct_usdc',
        currency: 'USDC',
        providerReference: 'ref',
      },
      endpoints: [endpointRow()],
    });
    const config = makeConfig();
    const delivery = new WebhookDeliveryService(db, config);
    const dispatcher = new WebhookDispatcherService(
      consumer,
      db,
      delivery,
      config,
    );
    const { captured, restore } = captureFetch();
    try {
      await dispatcher.handle({
        topic: 'payment.expired',
        key: INTENT_ID,
        payload: {},
        correlationId: INTENT_ID,
      });
      expect(captured).toHaveLength(1);
      const parsed = JSON.parse(captured[0].body) as { type: string };
      expect(parsed.type).toBe('payment.expired');
    } finally {
      restore();
    }
  });
});

// ---- idempotent intent creation ----
function makeIdemDb(existing?: {
  requestHash: string;
  responseStatus: number;
  responseBody: string;
}) {
  const inserts: unknown[] = [];
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        if (tbl === idempotencyKeys)
          return {
            where: () => ({
              limit: () => Promise.resolve(existing ? [existing] : []),
            }),
          };
        throw new Error('unknown table');
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        inserts.push(v);
        return Promise.resolve();
      },
    }),
  };
  return { db: { client } as unknown as DbService, inserts };
}

describe('Phase 6 E2E harness: Stripe-semantics idempotency', () => {
  it('returns a byte-identical stored response on a same-key same-body replay', async () => {
    const stored = {
      requestHash: 'hash-a',
      responseStatus: 201,
      responseBody: JSON.stringify({ id: INTENT_ID }),
    };
    const { db } = makeIdemDb(stored);
    const svc = new IdempotencyService(db);
    const produce = jest.fn();
    const res = await svc.run('m1', 'idem-1', 'hash-a', produce);
    expect(produce).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 201, body: { id: INTENT_ID } });
  });

  it('rejects a same-key different-body reuse with 409', async () => {
    const { db } = makeIdemDb({
      requestHash: 'hash-a',
      responseStatus: 201,
      responseBody: '{}',
    });
    const svc = new IdempotencyService(db);
    await expect(
      svc.run('m1', 'idem-1', 'hash-DIFFERENT', jest.fn()),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSE' });
  });
});

// ---- checkout surface: summary + blocking authorize + signed return URL ----
function makeCheckoutDb(merchant: Record<string, unknown>) {
  return {
    client: {
      select: () => ({
        from: (tbl: unknown) => {
          if (tbl === merchants)
            return {
              where: () => ({ limit: () => Promise.resolve([merchant]) }),
            };
          throw new Error('unknown table');
        },
      }),
    },
  } as unknown as DbService;
}

function checkoutMerchant() {
  return {
    id: MERCHANT_ID,
    name: 'Acme',
    displayName: 'Acme Store',
    status: 'active',
    intentTtlMinutes: null,
    allowedOrigins: ['https://acme.example.com'],
    kybStatus: 'verified',
    kybVerifiedAt: null,
    flatFeeBps: 0,
    fxSpreadBps: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function makeRes() {
  const cookie = jest.fn();
  return { res: { cookie } as unknown as Response, cookie };
}

function makeReq(cookie?: string): Request {
  return {
    headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {},
  } as unknown as Request;
}

describe('Phase 6 E2E harness: checkout surface', () => {
  it('serves a public summary with no USDC/FX leakage and sessionRecognized via peek', async () => {
    const intents = { findById: jest.fn().mockResolvedValue(intentRow()) };
    const sessions = { peek: jest.fn().mockResolvedValue(false) };
    const controller = new CheckoutController(
      intents as unknown as PaymentIntentService,
      {} as unknown as PaymentAuthorizationService,
      {} as unknown as IdentityService,
      sessions as unknown as SessionService,
      makeCheckoutDb(checkoutMerchant()),
      makeConfig(),
    );
    const summary = await controller.getSummary(makeReq(), INTENT_ID);
    expect(summary.merchantDisplayName).toBe('Acme Store');
    expect(summary.merchantOrigin).toBe('https://acme.example.com');
    expect(summary.sessionRecognized).toBe(false);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('usdcSettlementRaw');
    expect(serialized).not.toContain('fxRate');
  });

  it('blocks then returns succeeded with a verifiable signed return URL and an HttpOnly cookie, never authorized', async () => {
    const intents = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(intentRow({ status: 'authorized' }))
        .mockResolvedValueOnce(intentRow({ status: 'succeeded' })),
    };
    const auth = {
      authorize: jest.fn().mockResolvedValue({
        intentId: INTENT_ID,
        attemptId: 'a',
        status: 'authorized',
      }),
    };
    const identity = {
      resolveByProviderToken: jest.fn().mockResolvedValue({
        consumerId: 'c1',
        accountAddress: 'A',
        email: null,
      }),
    };
    const sessions = {
      peek: jest.fn(),
      issue: jest.fn().mockResolvedValue({ sessionId: 's1', token: 'fresh' }),
    };
    const controller = new CheckoutController(
      intents as unknown as PaymentIntentService,
      auth as unknown as PaymentAuthorizationService,
      identity as unknown as IdentityService,
      sessions as unknown as SessionService,
      makeCheckoutDb(checkoutMerchant()),
      makeConfig(),
    );
    controller.authorizeWaitMs = 60;
    controller.authorizePollMs = 10;
    const { res, cookie } = makeRes();

    const response = await controller.authorize(makeReq(), res, {
      reference: INTENT_ID,
      providerToken: 'privy-id-token',
    });

    expect(response.status).toBe('succeeded');
    expect(JSON.stringify(response)).not.toContain('authorized');
    expect(cookie).toHaveBeenCalledWith(
      COOKIE,
      'fresh',
      expect.objectContaining({ httpOnly: true, secure: true }),
    );
    const url = new URL(response.redirectUrl as string);
    const ts = Number(url.searchParams.get('xend_ts'));
    const sig = url.searchParams.get('xend_sig') as string;
    expect(
      verifyReturnUrl(
        'https://shop.example.com/return',
        INTENT_ID,
        'succeeded',
        ts,
        sig,
        RETURN_SECRET,
        900,
      ),
    ).toBe(true);
    // Tampered status fails.
    expect(
      verifyReturnUrl(
        'https://shop.example.com/return',
        INTENT_ID,
        'failed',
        ts,
        sig,
        RETURN_SECRET,
        900,
      ),
    ).toBe(false);
    // Stale timestamp fails.
    expect(
      verifyReturnUrl(
        'https://shop.example.com/return',
        INTENT_ID,
        'succeeded',
        ts,
        sig,
        RETURN_SECRET,
        900,
        ts + 1000,
      ),
    ).toBe(false);
  });

  it('times out to 502 PAYMENT_PROCESSING when no terminal status arrives', async () => {
    const intents = {
      findById: jest
        .fn()
        .mockResolvedValue(intentRow({ status: 'authorized' })),
    };
    const auth = {
      authorize: jest.fn().mockResolvedValue({
        intentId: INTENT_ID,
        attemptId: 'a',
        status: 'authorized',
      }),
    };
    const controller = new CheckoutController(
      intents as unknown as PaymentIntentService,
      auth as unknown as PaymentAuthorizationService,
      {} as unknown as IdentityService,
      { peek: jest.fn() } as unknown as SessionService,
      makeCheckoutDb(checkoutMerchant()),
      makeConfig(),
    );
    controller.authorizeWaitMs = 40;
    controller.authorizePollMs = 10;
    const { res } = makeRes();
    try {
      await controller.authorize(makeReq('sess'), res, {
        reference: INTENT_ID,
      });
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const http = err as HttpException;
      expect(http.getStatus()).toBe(502);
      expect(http.getResponse()).toMatchObject({ code: 'PAYMENT_PROCESSING' });
    }
  });

  it('maps an expired intent at authorize to 410 INTENT_EXPIRED (unpayable)', async () => {
    const intents = { findById: jest.fn().mockResolvedValue(intentRow()) };
    const auth = {
      authorize: jest.fn().mockRejectedValue(new IntentExpiredError('expired')),
    };
    const controller = new CheckoutController(
      intents as unknown as PaymentIntentService,
      auth as unknown as PaymentAuthorizationService,
      {} as unknown as IdentityService,
      { peek: jest.fn() } as unknown as SessionService,
      makeCheckoutDb(checkoutMerchant()),
      makeConfig(),
    );
    const { res } = makeRes();
    try {
      await controller.authorize(makeReq('sess'), res, {
        reference: INTENT_ID,
      });
      throw new Error('expected rejection');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(410);
      expect((err as HttpException).getResponse()).toMatchObject({
        code: 'INTENT_EXPIRED',
      });
    }
  });
});
