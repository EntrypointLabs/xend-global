import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { DbService } from '../../../db/db.service';
import type { EventPublisher } from '../../../events/event-publisher.interface';
import {
  merchants,
  paymentAttempts,
  payments,
  settlementAccounts,
} from '../../../db/schema';
import { BlockradarSettlementProvider } from './blockradar-settlement.provider';
import {
  DestinationUnverifiedError,
  MerchantKybRequiredError,
} from './settlement-offramp.errors';

const ENDPOINT = 'CHILD_ADDR_1111';
const SIGNATURE = 'SETTLE_SIG_1111';

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const map: Record<string, unknown> = {
    BLOCKRADAR_API_KEY: 'test_key',
    BLOCKRADAR_WEBHOOK_SECRET: 'test_secret',
    BLOCKRADAR_MASTER_WALLET_ID: 'mw_1',
    BLOCKRADAR_REFUND_SUPPORTED: false,
    BLOCKRADAR_SOLANA_NATIVE_ENABLED: false,
    ...overrides,
  };
  return { get: (k: string) => map[k] } as unknown as ConfigService;
}

interface DbOpts {
  account?: {
    merchantId: string;
    providerReference: string | null;
    payoutConfig: string | null;
  } | null;
  merchant?: { kybStatus: string };
  attempt?: { intentId: string } | null;
  payment?: { id: string } | null;
  insertBehaviors?: Array<'ok' | 'duplicate'>;
}

function makeDb(opts: DbOpts): {
  db: DbService;
  inserted: Record<string, unknown>[];
} {
  const inserted: Record<string, unknown>[] = [];
  const behaviors = opts.insertBehaviors ?? ['ok', 'ok'];
  const rowsFor = (tbl: unknown): unknown[] => {
    if (tbl === settlementAccounts) return opts.account ? [opts.account] : [];
    if (tbl === merchants) return opts.merchant ? [opts.merchant] : [];
    if (tbl === paymentAttempts) return opts.attempt ? [opts.attempt] : [];
    if (tbl === payments) return opts.payment ? [opts.payment] : [];
    return [];
  };
  const client = {
    select: () => ({
      from: (tbl: unknown) => ({
        where: () => ({ limit: () => Promise.resolve(rowsFor(tbl)) }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        const behavior = behaviors.shift() ?? 'ok';
        const duplicateErr = Object.assign(new Error('duplicate key'), {
          code: '23505',
        });
        const result = () =>
          behavior === 'duplicate'
            ? Promise.reject(duplicateErr)
            : Promise.resolve([{ id: `so_${inserted.length}` }]);
        return {
          returning: () => result(),
          then: (
            resolve: (v: unknown) => unknown,
            reject?: (e: unknown) => unknown,
          ) => result().then(resolve, reject),
        };
      },
    }),
  };
  return { db: { client } as unknown as DbService, inserted };
}

function makePublisher(): { events: EventPublisher; publish: jest.Mock } {
  const publish = jest.fn().mockResolvedValue(undefined);
  return { events: { publish } as EventPublisher, publish };
}

function makeProvider(
  db: DbService,
  events: EventPublisher,
  config: ConfigService,
): BlockradarSettlementProvider {
  const provider = new BlockradarSettlementProvider(db, config, events);
  provider.onModuleInit();
  return provider;
}

describe('BlockradarSettlementProvider', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('advertises exactly the frozen NGN/deferred capabilities (refundSupport config-driven)', () => {
    const { db } = makeDb({});
    const { events } = makePublisher();
    const off = makeProvider(db, events, makeConfig());
    expect(off.capabilities).toEqual({
      provider: 'blockradar',
      currencies: ['NGN'],
      refundSupport: false,
      settlementLatency: 'deferred',
    });

    const on = makeProvider(
      makeDb({}).db,
      makePublisher().events,
      makeConfig({ BLOCKRADAR_REFUND_SUPPORTED: true }),
    );
    expect(on.capabilities.refundSupport).toBe(true);
  });

  it('provisions a child endpoint with the frozen shape', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ data: { id: 'addr_1', address: ENDPOINT } }),
    } as Response);
    const provider = makeProvider(
      makeDb({}).db,
      makePublisher().events,
      makeConfig(),
    );
    const endpoint = await provider.provision({ merchantId: 'm_1' });
    expect(endpoint).toEqual({
      address: ENDPOINT,
      providerReference: 'addr_1',
      attributionRef: 'mw_1',
      payoutConfig: JSON.stringify({ masterWalletId: 'mw_1' }),
    });
  });

  it('handleIncomingSettlement returns pending, fires the convert-payout once, and is a no-op on the same signature', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    } as Response);
    const { db } = makeDb({
      account: {
        merchantId: 'm_1',
        providerReference: 'addr_1',
        payoutConfig: JSON.stringify({ verified: true }),
      },
      merchant: { kybStatus: 'verified' },
      attempt: { intentId: 'pi_1' },
      payment: { id: 'pay_1' },
      insertBehaviors: ['ok', 'duplicate'],
    });
    const { events, publish } = makePublisher();
    const provider = makeProvider(
      db,
      events,
      makeConfig({ BLOCKRADAR_SOLANA_NATIVE_ENABLED: true }),
    );

    const first = await provider.handleIncomingSettlement({
      endpointAddress: ENDPOINT,
      signature: SIGNATURE,
      amountRaw: '50000000',
    });
    expect(first).toEqual({ status: 'pending' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // convert-payout fired once
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'payout.initiated' }),
    );

    const second = await provider.handleIncomingSettlement({
      endpointAddress: ENDPOINT,
      signature: SIGNATURE,
      amountRaw: '50000000',
    });
    expect(second).toEqual({ status: 'pending' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // NO second convert-payout
    expect(publish).toHaveBeenCalledTimes(1); // NO second event
  });

  it('rejects an un-KYB’d merchant with MERCHANT_KYB_REQUIRED before any convert-payout', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const { db, inserted } = makeDb({
      account: {
        merchantId: 'm_1',
        providerReference: 'addr_1',
        payoutConfig: JSON.stringify({ verified: true }),
      },
      merchant: { kybStatus: 'pending' },
    });
    const provider = makeProvider(
      db,
      makePublisher().events,
      makeConfig({ BLOCKRADAR_SOLANA_NATIVE_ENABLED: true }),
    );
    await expect(
      provider.handleIncomingSettlement({
        endpointAddress: ENDPOINT,
        signature: SIGNATURE,
        amountRaw: '50000000',
      }),
    ).rejects.toBeInstanceOf(MerchantKybRequiredError);
    expect(inserted).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unverified bank destination with DESTINATION_UNVERIFIED before any convert-payout', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const { db, inserted } = makeDb({
      account: {
        merchantId: 'm_1',
        providerReference: 'addr_1',
        payoutConfig: JSON.stringify({ verified: false }),
      },
      merchant: { kybStatus: 'verified' },
    });
    const provider = makeProvider(
      db,
      makePublisher().events,
      makeConfig({ BLOCKRADAR_SOLANA_NATIVE_ENABLED: true }),
    );
    await expect(
      provider.handleIncomingSettlement({
        endpointAddress: ENDPOINT,
        signature: SIGNATURE,
        amountRaw: '50000000',
      }),
    ).rejects.toBeInstanceOf(DestinationUnverifiedError);
    expect(inserted).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reverse records a reversing row and returns a signature', async () => {
    const { db, inserted } = makeDb({
      account: {
        merchantId: 'm_1',
        providerReference: 'addr_1',
        payoutConfig: null,
      },
      insertBehaviors: ['ok'],
    });
    const provider = makeProvider(db, makePublisher().events, makeConfig());
    const res = await provider.reverse({
      endpointAddress: ENDPOINT,
      consumerAddress: 'CONSUMER_1',
      amountRaw: '10000000',
      paymentId: 'pay_1',
    });
    expect(res.signature).toBe('stub_reverse_pay_1');
    expect(inserted[0]).toMatchObject({
      direction: 'reverse',
      status: 'reversing',
      paymentId: 'pay_1',
    });
  });

  it('report returns balance and provider reference only', async () => {
    const { db } = makeDb({
      account: {
        merchantId: 'm_1',
        providerReference: 'addr_1',
        payoutConfig: null,
      },
    });
    const provider = makeProvider(db, makePublisher().events, makeConfig());
    const res = await provider.report({ endpointAddress: ENDPOINT });
    expect(res).toEqual({ balanceRaw: '0', providerReference: 'addr_1' });
  });

  it('verifyWebhookSignature accepts an exact HMAC-SHA512 and 401s on tamper', () => {
    const provider = makeProvider(
      makeDb({}).db,
      makePublisher().events,
      makeConfig(),
    );
    const raw = Buffer.from(JSON.stringify({ event: 'offramp.success' }));
    const good = createHmac('sha512', 'test_secret').update(raw).digest('hex');
    expect(() => provider.verifyWebhookSignature(raw, good)).not.toThrow();
    expect(() => provider.verifyWebhookSignature(raw, 'deadbeef')).toThrow(
      HttpException,
    );
  });

  it('parseWebhookEvent narrows an offramp.success and returns null for unowned types', () => {
    const provider = makeProvider(
      makeDb({}).db,
      makePublisher().events,
      makeConfig(),
    );
    const parsed = provider.parseWebhookEvent({
      event: 'offramp.success',
      data: {
        reference: SIGNATURE,
        amountMinor: '8000000',
        rate: '1600',
        providerTxRef: 'ptx_1',
        completedAt: '2026-07-12T00:00:00.000Z',
      },
    });
    expect(parsed).toMatchObject({
      type: 'paid',
      providerRef: SIGNATURE,
      ngnSettledMinor: '8000000',
    });
    expect(
      provider.parseWebhookEvent({ event: 'wallet.deposit', data: {} }),
    ).toBeNull();
    expect(provider.parseWebhookEvent({})).toBeNull();
  });
});
