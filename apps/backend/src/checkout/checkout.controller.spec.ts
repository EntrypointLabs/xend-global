import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { DbService } from '../db/db.service';
import { merchants, paymentIntents } from '../db/schema';
import type { PaymentIntentService } from '../payment/payment-intent.service';
import type { PaymentAuthorizationService } from '../capability/payment-authorization.service';
import type { IdentityService } from '../capability/identity.service';
import type { SessionService } from '../session/session.service';
import {
  IntentExpiredError,
  IntentNotFoundError,
} from '../payment/payment.errors';
import { CapacityExceededError } from '../capability/capability.errors';
import { CheckoutController } from './checkout.controller';
import { verifyReturnUrl } from './return-url';

type MerchantRow = typeof merchants.$inferSelect;
type IntentRow = typeof paymentIntents.$inferSelect;

const SECRET = 'checkout-return-secret';
const COOKIE = 'xend_checkout_session';

function merchantRow(over: Partial<MerchantRow> = {}): MerchantRow {
  return {
    id: 'm1',
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
    ...over,
  };
}

function intentRow(over: Partial<IntentRow> = {}): IntentRow {
  return {
    id: 'pi_1',
    merchantId: 'm1',
    consumerId: null,
    status: 'authorized',
    usdcSettlementRaw: '1000000',
    ngnDisplayMinor: '160000',
    fxRate: '1600.00',
    fxSource: 'pilot-static',
    fxQuotedAt: new Date('2026-01-01'),
    merchantReference: null,
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

function makeConfig(): ConfigService {
  return {
    getOrThrow: (k: string) => {
      switch (k) {
        case 'CHECKOUT_SESSION_COOKIE':
          return COOKIE;
        case 'CHECKOUT_RETURN_URL_SECRET':
          return SECRET;
        case 'CHECKOUT_RETURN_URL_TTL_SECONDS':
          return 900;
        case 'SESSION_ABSOLUTE_TTL_DAYS':
          return 90;
        default:
          throw new Error(`unexpected key ${k}`);
      }
    },
  } as unknown as ConfigService;
}

function makeDb(merchant: MerchantRow | null) {
  return {
    client: {
      select: () => ({
        from: (tbl: unknown) => {
          if (tbl === merchants)
            return {
              where: () => ({
                limit: () => Promise.resolve(merchant ? [merchant] : []),
              }),
            };
          throw new Error('unknown table');
        },
      }),
    },
  } as unknown as DbService;
}

function makeReq(cookie?: string): Request {
  return {
    headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {},
  } as unknown as Request;
}

function makeRes() {
  const cookie = jest.fn();
  return { res: { cookie } as unknown as Response, cookie };
}

interface Fakes {
  intents: { findById: jest.Mock };
  auth: { authorize: jest.Mock };
  identity: { resolveByProviderToken: jest.Mock };
  sessions: {
    peek: jest.Mock;
    issue: jest.Mock;
    validate: jest.Mock;
    rotate: jest.Mock;
  };
}

function makeController(
  merchant: MerchantRow | null,
  fakes: Partial<Fakes> = {},
) {
  const intents = fakes.intents ?? { findById: jest.fn() };
  const auth = fakes.auth ?? { authorize: jest.fn() };
  const identity = fakes.identity ?? { resolveByProviderToken: jest.fn() };
  const sessions = fakes.sessions ?? {
    peek: jest.fn(),
    issue: jest.fn(),
    validate: jest.fn(),
    rotate: jest.fn(),
  };
  const controller = new CheckoutController(
    intents as unknown as PaymentIntentService,
    auth as unknown as PaymentAuthorizationService,
    identity as unknown as IdentityService,
    sessions as unknown as SessionService,
    makeDb(merchant),
    makeConfig(),
  );
  controller.authorizeWaitMs = 60;
  controller.authorizePollMs = 10;
  return { controller, intents, auth, identity, sessions };
}

async function expectRejectHttp(
  p: Promise<unknown>,
  status: number,
  code: string,
) {
  try {
    await p;
    throw new Error('expected rejection');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const http = err as HttpException;
    expect(http.getStatus()).toBe(status);
    expect(http.getResponse()).toMatchObject({ code });
  }
}

describe('CheckoutController.getSummary', () => {
  it('returns exactly the camelCase contract fields, no USDC/FX leakage', async () => {
    const { controller, intents } = makeController(merchantRow());
    intents.findById.mockResolvedValue(intentRow());
    const summary = await controller.getSummary(makeReq(), 'pi_1');

    expect(Object.keys(summary).sort()).toEqual(
      [
        'expiresAt',
        'livemode',
        'merchantDisplayName',
        'merchantOrigin',
        'ngnDisplayMinor',
        'reference',
        'sessionRecognized',
        'status',
      ].sort(),
    );
    expect(summary.merchantDisplayName).toBe('Acme Store');
    expect(summary.merchantOrigin).toBe('https://acme.example.com');
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('usdcSettlementRaw');
    expect(serialized).not.toContain('fxRate');
    expect(serialized).not.toContain('1000000');
  });

  it('reports sessionRecognized=false with no cookie and never mutates the session', async () => {
    const sessions = {
      peek: jest.fn().mockResolvedValue(true),
      issue: jest.fn(),
      validate: jest.fn(),
      rotate: jest.fn(),
    };
    const { controller, intents } = makeController(merchantRow(), { sessions });
    intents.findById.mockResolvedValue(intentRow());
    const summary = await controller.getSummary(makeReq(), 'pi_1');
    expect(summary.sessionRecognized).toBe(false);
    expect(sessions.peek).not.toHaveBeenCalled();
    expect(sessions.validate).not.toHaveBeenCalled();
    expect(sessions.rotate).not.toHaveBeenCalled();
  });

  it('reports sessionRecognized=true for a valid cookie via the non-destructive peek only', async () => {
    const sessions = {
      peek: jest.fn().mockResolvedValue(true),
      issue: jest.fn(),
      validate: jest.fn(),
      rotate: jest.fn(),
    };
    const { controller, intents } = makeController(merchantRow(), { sessions });
    intents.findById.mockResolvedValue(intentRow());
    const summary = await controller.getSummary(makeReq('tok'), 'pi_1');
    expect(summary.sessionRecognized).toBe(true);
    expect(sessions.peek).toHaveBeenCalledWith('tok', 'm1');
    expect(sessions.validate).not.toHaveBeenCalled();
    expect(sessions.rotate).not.toHaveBeenCalled();
  });

  it('includes a signed cancelUrl when the intent carries one', async () => {
    const { controller, intents } = makeController(merchantRow());
    intents.findById.mockResolvedValue(
      intentRow({ cancelUrl: 'https://shop.example.com/cancel' }),
    );
    const summary = await controller.getSummary(makeReq(), 'pi_1');
    expect(summary.cancelUrl).toBeDefined();
    const url = new URL(summary.cancelUrl as string);
    expect(
      verifyReturnUrl(
        'https://shop.example.com/cancel',
        'pi_1',
        'canceled',
        Number(url.searchParams.get('xend_ts')),
        url.searchParams.get('xend_sig') as string,
        SECRET,
        900,
      ),
    ).toBe(true);
  });

  it('maps an absent intent to 404', async () => {
    const { controller, intents } = makeController(merchantRow());
    intents.findById.mockRejectedValue(new IntentNotFoundError('nope'));
    await expectRejectHttp(
      controller.getSummary(makeReq(), 'pi_x'),
      404,
      'INTENT_NOT_FOUND',
    );
  });
});

describe('CheckoutController.authorize', () => {
  it('session-cookie path authorizes and sets the rotated HttpOnly cookie', async () => {
    const auth = {
      authorize: jest.fn().mockResolvedValue({
        intentId: 'pi_1',
        attemptId: 'att_1',
        status: 'authorized',
        rotatedSessionToken: 'rotated-token',
      }),
    };
    const { controller, intents } = makeController(merchantRow(), { auth });
    const resPair = makeRes();
    intents.findById
      .mockResolvedValueOnce(intentRow({ status: 'authorized' }))
      .mockResolvedValueOnce(intentRow({ status: 'succeeded' }));

    const response = await controller.authorize(
      makeReq('sess-tok'),
      resPair.res,
      {
        reference: 'pi_1',
      },
    );

    expect(auth.authorize).toHaveBeenCalledWith({
      intentId: 'pi_1',
      sessionToken: 'sess-tok',
    });
    expect(resPair.cookie).toHaveBeenCalledWith(
      COOKIE,
      'rotated-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      }),
    );
    expect(response.status).toBe('succeeded');
    expect(response.redirectUrl).toBeDefined();
    const url = new URL(response.redirectUrl as string);
    expect(
      verifyReturnUrl(
        'https://shop.example.com/return',
        'pi_1',
        'succeeded',
        Number(url.searchParams.get('xend_ts')),
        url.searchParams.get('xend_sig') as string,
        SECRET,
        900,
      ),
    ).toBe(true);
    expect(JSON.stringify(response)).not.toContain('authorized');
  });

  it('provider-token path resolves the Consumer, issues a Session, and sets the cookie', async () => {
    const auth = {
      authorize: jest.fn().mockResolvedValue({
        intentId: 'pi_1',
        attemptId: 'att_1',
        status: 'authorized',
      }),
    };
    const identity = {
      resolveByProviderToken: jest.fn().mockResolvedValue({
        consumerId: 'c1',
        accountAddress: 'Addr',
        email: null,
      }),
    };
    const sessions = {
      peek: jest.fn(),
      issue: jest
        .fn()
        .mockResolvedValue({ sessionId: 's1', token: 'fresh-token' }),
      validate: jest.fn(),
      rotate: jest.fn(),
    };
    const { controller, intents } = makeController(merchantRow(), {
      auth,
      identity,
      sessions,
    });
    const resPair = makeRes();
    intents.findById
      .mockResolvedValueOnce(intentRow({ status: 'authorized' }))
      .mockResolvedValueOnce(intentRow({ status: 'succeeded' }));

    const response = await controller.authorize(makeReq(), resPair.res, {
      reference: 'pi_1',
      providerToken: 'privy-id-token',
    });

    expect(identity.resolveByProviderToken).toHaveBeenCalledWith(
      'privy-id-token',
    );
    expect(auth.authorize).toHaveBeenCalledWith({
      intentId: 'pi_1',
      consumerId: 'c1',
    });
    expect(sessions.issue).toHaveBeenCalledWith({
      consumerId: 'c1',
      merchantId: 'm1',
      issuingIntentId: 'pi_1',
    });
    expect(resPair.cookie).toHaveBeenCalledWith(
      COOKIE,
      'fresh-token',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(response.status).toBe('succeeded');
  });

  it('rejects with 401 and no service write when no credential is supplied', async () => {
    const auth = { authorize: jest.fn() };
    const identity = { resolveByProviderToken: jest.fn() };
    const sessions = {
      peek: jest.fn(),
      issue: jest.fn(),
      validate: jest.fn(),
      rotate: jest.fn(),
    };
    const { controller, intents } = makeController(merchantRow(), {
      auth,
      identity,
      sessions,
    });
    intents.findById.mockResolvedValue(intentRow());
    const resPair = makeRes();
    await expectRejectHttp(
      controller.authorize(makeReq(), resPair.res, { reference: 'pi_1' }),
      401,
      'SESSION_INVALID',
    );
    expect(auth.authorize).not.toHaveBeenCalled();
    expect(identity.resolveByProviderToken).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('returns { status: failed } with a failed-signed redirectUrl on a failed settlement', async () => {
    const auth = {
      authorize: jest.fn().mockResolvedValue({
        intentId: 'pi_1',
        attemptId: 'a',
        status: 'authorized',
      }),
    };
    const { controller, intents } = makeController(merchantRow(), { auth });
    const resPair = makeRes();
    intents.findById
      .mockResolvedValueOnce(intentRow({ status: 'authorized' }))
      .mockResolvedValueOnce(intentRow({ status: 'failed' }));

    const response = await controller.authorize(makeReq('sess'), resPair.res, {
      reference: 'pi_1',
    });
    expect(response.status).toBe('failed');
    const url = new URL(response.redirectUrl as string);
    expect(url.searchParams.get('xend_status')).toBe('failed');
  });

  it('times out to 502 PAYMENT_PROCESSING when no terminal status arrives', async () => {
    const auth = {
      authorize: jest.fn().mockResolvedValue({
        intentId: 'pi_1',
        attemptId: 'a',
        status: 'authorized',
      }),
    };
    const { controller, intents } = makeController(merchantRow(), { auth });
    const resPair = makeRes();
    intents.findById.mockResolvedValue(intentRow({ status: 'authorized' }));
    await expectRejectHttp(
      controller.authorize(makeReq('sess'), resPair.res, { reference: 'pi_1' }),
      502,
      'PAYMENT_PROCESSING',
    );
  });

  it('maps INTENT_EXPIRED to 410 and CAPACITY_EXCEEDED to 409', async () => {
    const resPair = makeRes();

    const expiredAuth = {
      authorize: jest.fn().mockRejectedValue(new IntentExpiredError('expired')),
    };
    const c1 = makeController(merchantRow(), { auth: expiredAuth });
    c1.intents.findById.mockResolvedValue(intentRow());
    await expectRejectHttp(
      c1.controller.authorize(makeReq('sess'), resPair.res, {
        reference: 'pi_1',
      }),
      410,
      'INTENT_EXPIRED',
    );

    const capAuth = {
      authorize: jest
        .fn()
        .mockRejectedValue(new CapacityExceededError('DAILY_CAP', 'over')),
    };
    const c2 = makeController(merchantRow(), { auth: capAuth });
    c2.intents.findById.mockResolvedValue(intentRow());
    await expectRejectHttp(
      c2.controller.authorize(makeReq('sess'), resPair.res, {
        reference: 'pi_1',
      }),
      409,
      'CAPACITY_EXCEEDED',
    );
  });
});
