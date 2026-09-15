import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import { paymentIntents } from '../db/schema';
import type { FxQuoteProvider } from '../fx/fx-quote-provider.interface';
import type { PaymentIntentService } from '../payment/payment-intent.service';
import type { MerchantRequest } from './api-key.guard';
import type { IdempotencyService } from './idempotency.service';
import { MerchantController } from './merchant.controller';

type IntentRow = typeof paymentIntents.$inferSelect;

function intentRow(over: Partial<IntentRow> = {}): IntentRow {
  return {
    id: 'pi_1',
    merchantId: 'm1',
    consumerId: null,
    status: 'created',
    usdcSettlementRaw: '25000000',
    displayCurrency: 'USD',
    displayAmountMinor: '2500',
    fxRate: null,
    fxSource: null,
    fxQuotedAt: null,
    merchantReference: null,
    idempotencyKey: null,
    mode: 'test',
    returnUrl: null,
    cancelUrl: null,
    expiresAt: new Date('2026-01-01T01:00:00Z'),
    authorizedAt: null,
    approvalDeferredAt: null,
    metadata: null,
    openerOrigin: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function makeController(created: IntentRow) {
  const updates: Record<string, unknown>[] = [];
  const intents = {
    create: jest.fn().mockResolvedValue(created),
    findById: jest.fn().mockResolvedValue(created),
  };
  const db = {
    client: {
      update: () => ({
        set: (v: Record<string, unknown>) => {
          updates.push(v);
          return {
            where: () => ({
              returning: () => Promise.resolve([{ ...created, ...v }]),
            }),
          };
        },
      }),
    },
  } as unknown as DbService;
  const idempotency = {
    run: (
      _m: string,
      _k: string | undefined,
      _h: string,
      produce: () => Promise<unknown>,
    ) => produce(),
  } as unknown as IdempotencyService;
  const config = {
    get: () => undefined,
    getOrThrow: (k: string) => {
      if (k === 'FX_RATE_DECIMALS') return 2;
      throw new Error(`unexpected key ${k}`);
    },
  } as unknown as ConfigService;
  const fx = {
    getQuote: jest.fn().mockResolvedValue({
      ngnPerUsdc: '1600.00',
      source: 'pilot-static',
      quotedAt: new Date('2026-01-01'),
    }),
  } as unknown as FxQuoteProvider;
  const controller = new MerchantController(
    intents as unknown as PaymentIntentService,
    idempotency,
    config,
    db,
    fx,
  );
  return { controller, intents, updates };
}

const req = {
  merchant: { merchantId: 'm1', apiKeyId: 'ak1', mode: 'test' },
} as unknown as MerchantRequest;

describe('MerchantController.createIntent', () => {
  it('echoes a USDC request in USDC raw units, not the dollars shown to the shopper', async () => {
    const { controller } = makeController(intentRow());
    const out = await controller.createIntent(req, {
      amount: '25000000',
      currency: 'USDC',
    });
    expect(out.currency).toBe('USDC');
    expect(out.amount).toBe('25000000');
    expect(out.usdc_settlement_raw).toBe('25000000');
    expect(out.metadata).toBeNull();
  });

  it('echoes an NGN request in kobo', async () => {
    const { controller, intents } = makeController(
      intentRow({
        displayCurrency: 'NGN',
        displayAmountMinor: '800000',
        usdcSettlementRaw: '5000000',
        fxRate: '1600.00',
      }),
    );
    const out = await controller.createIntent(req, {
      amount: '800000',
      currency: 'NGN',
    });
    expect(out.currency).toBe('NGN');
    expect(out.amount).toBe('800000');
    const params = (intents.create.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(params.displayCurrency).toBe('NGN');
    expect(params.usdcSettlementRaw).toBe('5000000');
  });

  it('persists metadata on create and returns it', async () => {
    const { controller, updates } = makeController(intentRow());
    const out = await controller.createIntent(req, {
      amount: '25000000',
      currency: 'USDC',
      metadata: { order_id: 'A-2043' },
    });
    expect(updates).toEqual([
      expect.objectContaining({ metadata: { order_id: 'A-2043' } }),
    ]);
    expect(out.metadata).toEqual({ order_id: 'A-2043' });
  });

  it('does not rewrite metadata an idempotent replay already carries', async () => {
    const { controller, updates } = makeController(
      intentRow({ metadata: { order_id: 'A-2043' } }),
    );
    const out = await controller.createIntent(req, {
      amount: '25000000',
      currency: 'USDC',
      metadata: { order_id: 'A-2043' },
    });
    expect(updates).toEqual([]);
    expect(out.metadata).toEqual({ order_id: 'A-2043' });
  });
});

describe('MerchantController.getIntent', () => {
  it('returns metadata with the intent', async () => {
    const { controller } = makeController(
      intentRow({ metadata: { order_id: 'A-2043' } }),
    );
    const out = await controller.getIntent(req, 'pi_1');
    expect(out.metadata).toEqual({ order_id: 'A-2043' });
    expect(out.currency).toBe('USDC');
  });
});
