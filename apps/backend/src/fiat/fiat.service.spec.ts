/* eslint-disable @typescript-eslint/require-await -- The in-memory store implements an asynchronous persistence contract with atomic synchronous mutations. */
import { ConfigService } from '@nestjs/config';
import { FiatService } from './fiat.service';
import { FiatProviderRegistry } from './fiat-provider.registry';
import { SimulatorFiatProvider } from './providers/simulator-fiat.provider';
import type { FiatStore } from './fiat.repository';
import type { FiatOrder, FiatQuote, StoredFiatOrder } from './fiat.types';
import { FiatError } from './fiat.errors';
import type { FiatVerificationService } from './verification/verification.service';
import { decimalToMinor, minorToDecimal } from './fiat-money';

jest.mock('./fiat.repository', () => ({ FIAT_STORE: Symbol('test-store') }));

const copy = <T>(value: T): T => structuredClone(value);
/** Detached reads and atomic uniqueness/event updates, matching the Pg store contract. */
class MemoryStore implements FiatStore {
  quotes = new Map<string, { userId: string; quote: FiatQuote }>();
  orders = new Map<string, StoredFiatOrder>();
  events = new Map<string, string>();
  async saveQuote(userId: string, quote: FiatQuote) {
    this.quotes.set(quote.id, copy({ userId, quote }));
  }
  async quote(userId: string, id: string) {
    const row = this.quotes.get(id);
    return row?.userId === userId ? copy(row.quote) : null;
  }
  async order(userId: string, id: string) {
    const row = this.orders.get(id);
    return row?.userId === userId ? copy(row) : null;
  }
  async byKey(userId: string, key: string) {
    const row = [...this.orders.values()].find(
      (r) => r.userId === userId && r.idempotencyKey === key,
    );
    return row ? copy(row) : null;
  }
  async list(userId: string) {
    return [...this.orders.values()]
      .filter((r) => r.userId === userId)
      .map((r) => copy(r.order));
  }
  async since(userId: string, since: Date) {
    return [...this.orders.values()]
      .filter(
        (r) =>
          r.userId === userId &&
          Date.parse(r.order.createdAt) >= since.getTime(),
      )
      .map((r) => copy(r.order));
  }
  async byProviderReference(provider: string, reference: string) {
    const row = [...this.orders.values()].find(
      (r) =>
        r.providerReference === reference &&
        r.order.route.provider === provider,
    );
    return row ? copy(row) : null;
  }
  async byId(orderId: string) {
    const row = this.orders.get(orderId);
    return row ? copy(row) : null;
  }
  async create(row: StoredFiatOrder) {
    if (
      [...this.orders.values()].some(
        (r) =>
          r.order.quote.id === row.order.quote.id ||
          (r.userId === row.userId && r.idempotencyKey === row.idempotencyKey),
      )
    )
      return false;
    this.orders.set(row.order.id, copy(row));
    return true;
  }
  async save(row: StoredFiatOrder) {
    this.orders.set(row.order.id, copy(row));
  }
  async vault(): Promise<string | null> {
    return null;
  }
  async event(
    userId: string,
    id: string,
    key: string,
    hash: string,
    reduce: (order: FiatOrder) => FiatOrder,
  ) {
    const row = this.orders.get(id);
    if (!row || row.userId !== userId)
      throw new FiatError('ORDER_NOT_FOUND', 'Missing', 404);
    const eventKey = `${id}:${key}`;
    const prior = this.events.get(eventKey);
    if (prior) {
      if (prior !== hash)
        throw new FiatError('IDEMPOTENCY_CONFLICT', 'Conflict', 409);
      return copy(row.order);
    }
    const result = reduce(copy(row.order));
    this.orders.set(id, copy({ ...row, order: result }));
    this.events.set(eventKey, hash);
    return copy(result);
  }
}
const errorCode = (code: string): unknown => {
  const response: unknown = expect.objectContaining({ code });
  return expect.objectContaining({ response });
};

describe('FiatService consumer order lifecycle', () => {
  let service: FiatService;
  let store: MemoryStore;
  let provider: SimulatorFiatProvider;
  let settings: Record<string, string>;
  beforeEach(() => {
    store = new MemoryStore();
    provider = new SimulatorFiatProvider();
    settings = { NODE_ENV: 'test', FIAT_ENABLED_PROVIDERS: 'simulator' };
    const config = { get: (key: string) => settings[key] } as ConfigService;
    service = new FiatService(
      new FiatProviderRegistry([provider], config),
      store,
    );
  });
  const request = (quoteId: string, idempotencyKey = 'create-key') => ({
    quoteId,
    idempotencyKey,
    fields: {},
  });
  const getQuote = () =>
    service.quote('alice', {
      routeId: 'simulator:receive',
      amountMinor: '1000000',
    });
  const event = (
    id: string,
    value: 'payment_received' | 'complete' | 'fail' | 'return' | 'expire',
    key: string = value,
  ) => service.simulate('alice', id, { event: value, idempotencyKey: key });

  it('isolates quotes, orders, listing and state changes by caller', async () => {
    const quote = await getQuote();
    await expect(service.create('bob', request(quote.id))).rejects.toEqual(
      errorCode('QUOTE_NOT_FOUND'),
    );
    const order = await service.create('alice', request(quote.id));
    await expect(service.order('bob', order.id)).rejects.toEqual(
      errorCode('ORDER_NOT_FOUND'),
    );
    await expect(
      service.simulate('bob', order.id, {
        event: 'fail',
        idempotencyKey: 'event-key',
      }),
    ).rejects.toEqual(errorCode('ORDER_NOT_FOUND'));
    expect(await service.list('bob')).toEqual({ orders: [] });
    expect((await service.list('alice')).orders).toHaveLength(1);
  });
  it('rejects expired quotes without calling the provider', async () => {
    const quote = await getQuote();
    quote.expiresAt = new Date(0).toISOString();
    await store.saveQuote('alice', quote);
    const create = jest.spyOn(provider, 'createOrder');
    await expect(service.create('alice', request(quote.id))).rejects.toEqual(
      errorCode('QUOTE_EXPIRED'),
    );
    expect(create).not.toHaveBeenCalled();
    expect(store.orders.size).toBe(0);
  });
  afterEach(() => jest.restoreAllMocks());
  it.each(['debit', 'credit', 'negative-fee', 'fee-decimals'])(
    'rejects provider monetary unit corruption: %s',
    async (invalid) => {
      const route = (await provider.routes())[0];
      const quote = await provider.quote(route, '1000000');
      if (invalid === 'debit') quote.debit.decimals = 6;
      if (invalid === 'credit') quote.credit.decimals = 2;
      if (invalid === 'negative-fee')
        quote.fees = [{ currency: 'NGN', amountMinor: '-1', decimals: 2 }];
      if (invalid === 'fee-decimals')
        quote.fees = [{ currency: 'NGN', amountMinor: '1', decimals: 6 }];
      jest.spyOn(provider, 'quote').mockResolvedValue(quote);
      await expect(getQuote()).rejects.toEqual(
        errorCode('INVALID_PROVIDER_QUOTE'),
      );
      expect(store.quotes.size).toBe(0);
    },
  );
  it('rechecks quote expiry after asynchronous route discovery', async () => {
    const quote = await getQuote();
    const routes = await provider.routes();
    const clock = jest.spyOn(Date, 'now');
    jest.spyOn(provider, 'routes').mockImplementation(() => {
      clock.mockReturnValue(Date.parse(quote.expiresAt) + 1);
      return Promise.resolve(routes);
    });
    const create = jest.spyOn(provider, 'createOrder');
    await expect(service.create('alice', request(quote.id))).rejects.toEqual(
      errorCode('QUOTE_EXPIRED'),
    );
    expect(create).not.toHaveBeenCalled();
    expect(store.orders.size).toBe(0);
  });
  it('recovers a creation left behind by a crash without issuing another provider order', async () => {
    const quote = await getQuote();
    const order = await service.create('alice', request(quote.id));
    const row = store.orders.get(order.id)!;
    row.order.status = 'creating';
    row.order.createdAt = new Date(Date.now() - 31_000).toISOString();
    row.providerReference = null;
    const create = jest.spyOn(provider, 'createOrder');
    expect((await service.order('alice', order.id)).status).toBe(
      'needs_attention',
    );
    expect(store.orders.get(order.id)?.order.status).toBe('needs_attention');
    expect((await service.create('alice', request(quote.id))).status).toBe(
      'needs_attention',
    );
    expect(create).not.toHaveBeenCalled();
    expect(store.events.size).toBe(1);
  });
  it('expires stored payment instructions on read and preserves late funding for review', async () => {
    const order = await service.create('alice', request((await getQuote()).id));
    store.orders.get(order.id)!.order.instructions.expiresAt = new Date(
      0,
    ).toISOString();
    expect((await service.order('alice', order.id)).status).toBe('expired');
    expect((await event(order.id, 'payment_received')).status).toBe(
      'needs_attention',
    );
  });
  it('makes concurrent identical requests create only one provider order', async () => {
    const quote = await getQuote();
    const create = jest.spyOn(provider, 'createOrder');
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.create('alice', request(quote.id)),
      ),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect((await service.create('alice', request(quote.id))).status).toBe(
      'awaiting_payment',
    );
  });
  it('rejects a reused request key with changed payload and a second key for one quote', async () => {
    const quote = await getQuote();
    await service.create('alice', request(quote.id));
    await expect(
      service.create('alice', {
        ...request(quote.id),
        fields: { changed: 'yes' },
      }),
    ).rejects.toEqual(errorCode('IDEMPOTENCY_CONFLICT'));
    await expect(
      service.create('alice', request(quote.id, 'another-key')),
    ).rejects.toEqual(errorCode('ORDER_CONFLICT'));
  });
  it('preserves uncertain creation and never retries provider creation', async () => {
    const quote = await getQuote();
    const create = jest
      .spyOn(provider, 'createOrder')
      .mockRejectedValue(new Error('timeout after acceptance'));
    await expect(service.create('alice', request(quote.id))).rejects.toEqual(
      errorCode('RECONCILIATION_REQUIRED'),
    );
    expect((await service.create('alice', request(quote.id))).status).toBe(
      'needs_attention',
    );
    await expect(
      service.create('alice', request(quote.id, 'replacement')),
    ).rejects.toEqual(errorCode('ORDER_CONFLICT'));
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('blocks a new order if its provider was disabled after quoting', async () => {
    const quote = await getQuote();
    settings.FIAT_ENABLED_PROVIDERS = '';
    await expect(service.create('alice', request(quote.id))).rejects.toEqual(
      errorCode('ROUTE_UNAVAILABLE'),
    );
    expect(store.orders.size).toBe(0);
  });
  it('requires funding before completion and distinguishes a funded failure from a return', async () => {
    const order = await service.create('alice', request((await getQuote()).id));
    await expect(event(order.id, 'complete')).rejects.toEqual(
      errorCode('ORDER_CONFLICT'),
    );
    expect((await event(order.id, 'payment_received')).status).toBe(
      'processing',
    );
    expect((await event(order.id, 'fail')).status).toBe('return_pending');
    expect((await event(order.id, 'return')).status).toBe('returned');
    await expect(
      event(order.id, 'complete', 'retry-completion'),
    ).rejects.toEqual(errorCode('ORDER_CONFLICT'));
  });
  it('deduplicates concurrent events and rejects changed event payloads', async () => {
    const order = await service.create('alice', request((await getQuote()).id));
    await event(order.id, 'payment_received');
    const results = await Promise.all([
      event(order.id, 'complete'),
      event(order.id, 'complete'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['completed', 'completed']);
    await expect(event(order.id, 'fail', 'complete')).rejects.toEqual(
      errorCode('IDEMPOTENCY_CONFLICT'),
    );
    expect((await service.order('alice', order.id)).status).toBe('completed');
  });
  it('flags late funding of an expired order for review', async () => {
    const order = await service.create('alice', request((await getQuote()).id));
    expect((await event(order.id, 'expire')).status).toBe('expired');
    expect((await event(order.id, 'payment_received')).status).toBe(
      'needs_attention',
    );
  });
  it('uses exact integer amounts in both simulated directions without bank instructions', async () => {
    const receive = await getQuote();
    expect(receive.credit).toEqual({
      currency: 'USDC',
      decimals: 6,
      amountMinor: '6666666',
    });
    const send = await service.quote('alice', {
      routeId: 'simulator:send',
      amountMinor: '10000001',
    });
    expect(send.credit).toEqual({
      currency: 'NGN',
      decimals: 2,
      amountMinor: '1500000',
    });
    const order = await service.create('alice', request(send.id));
    expect(order.simulation).toBe(true);
    expect(order.instructions.kind).toBe('simulation');
    expect(order.instructions.accountNumber).toBeUndefined();
  });
});

describe('fiat decimal boundaries', () => {
  it('round-trips large values without binary floating-point loss', () => {
    const value = '9007199254740993.123456';
    expect(decimalToMinor(value, 6)).toBe('9007199254740993123456');
    expect(minorToDecimal('9007199254740993123456', 6)).toBe(value);
    expect(minorToDecimal('1', 2)).toBe('0.01');
    expect(minorToDecimal('500', 0)).toBe('500');
  });
  it('rejects precision loss and malformed monetary values', () => {
    for (const value of ['1.001', '-1', '1e3', 'NaN'])
      expect(() => decimalToMinor(value, 2)).toThrow();
    expect(decimalToMinor('1.2300', 2)).toBe('123');
  });
});

describe('FiatService real ramp orders', () => {
  const VAULT = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
  class RampStore extends MemoryStore {
    async vault(): Promise<string | null> {
      return VAULT;
    }
  }
  const route = {
    id: 'paj:ngn-usdc',
    provider: 'paj',
    direction: 'receive' as const,
    environment: 'production' as const,
    sourceCurrency: 'NGN' as const,
    destinationCurrency: 'USDC' as const,
    network: 'solana' as const,
    quoteAvailable: true,
    orderAvailable: true,
    accountKinds: ['temporary' as const],
    holdsFiat: false,
    thirdPartyPayments: 'unknown' as const,
  };
  let reported: { status: FiatOrder['status'] } = {
    status: 'awaiting_payment',
  };
  const ramp = {
    name: 'paj',
    routes: async () => [route],
    quote: async (_r: unknown, amountMinor: string) => ({
      reference: 'r',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      debit: { currency: 'NGN' as const, amountMinor, decimals: 2 as const },
      credit: {
        currency: 'USDC' as const,
        amountMinor: '1000000',
        decimals: 6 as const,
      },
      fees: [],
      fields: [],
      paymentStep: 'manual_transfer' as const,
    }),
    createOrder: jest.fn(async (input: { idempotencyKey: string }) => ({
      reference: `ref-${input.idempotencyKey}`,
      status: 'awaiting_payment' as const,
      instructions: {
        kind: 'bank_transfer' as const,
        message: 'pay',
        accountNumber: '9912345678',
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    })),
    getOrder: jest.fn(async (reference: string) => ({
      reference,
      status: reported.status,
    })),
  };
  let customer: string | null;
  let service: FiatService;
  beforeEach(() => {
    customer = null;
    reported = { status: 'awaiting_payment' };
    ramp.createOrder.mockClear();
    const settings: Record<string, string> = {
      NODE_ENV: 'test',
      FIAT_ENABLED_PROVIDERS: 'paj',
      FIAT_WEBHOOK_BASE_URL: 'https://api.example/',
      FIAT_WEBHOOK_TOKEN_SECRET: 'hook-secret',
    };
    const config = { get: (key: string) => settings[key] } as ConfigService;
    service = new FiatService(
      new FiatProviderRegistry([ramp], config),
      new RampStore(),
      {
        verifiedCustomerId: async () => customer,
      } as unknown as FiatVerificationService,
      config,
    );
  });
  const quote = (naira: number) =>
    service.quote('ada', {
      routeId: 'paj:ngn-usdc',
      amountMinor: String(naira * 100),
    });
  const create = (quoteId: string, key: string) =>
    service.create('ada', { quoteId, idempotencyKey: key, fields: {} });

  it('lets an unverified Consumer move ₦50,000 and asks for BVN above it', async () => {
    const ok = await quote(50_000);
    expect(ok.verification?.verificationRequired).toBe(false);
    const order = await create(ok.id, 'key-000001');
    expect(order.status).toBe('awaiting_payment');
    expect(ramp.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ destinationAddress: VAULT }),
    );
    const hook = ramp.createOrder.mock.calls[0][0] as { webhookUrl?: string };
    expect(hook.webhookUrl).toMatch(
      new RegExp(
        `^https://api\\.example/webhooks/fiat/paj/orders/${order.id}/[0-9a-f]{40}$`,
      ),
    );
    expect(ramp.createOrder.mock.calls[0][0]).not.toHaveProperty('customerId');

    const next = await quote(1);
    expect(next.verification?.verificationRequired).toBe(true);
    await expect(create(next.id, 'key-000002')).rejects.toEqual(
      errorCode('VERIFICATION_REQUIRED'),
    );
    expect(ramp.createOrder).toHaveBeenCalledTimes(1);
  });

  it('sends the verified customer id and lifts the limit', async () => {
    customer = 'cus_1';
    const big = await quote(400_000);
    expect(big.verification?.verificationRequired).toBe(false);
    await create(big.id, 'key-000003');
    expect(ramp.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_1' }),
    );
  });

  it('records what the provider reports, and a refusal leaves nothing to review', async () => {
    const q = await quote(10_000);
    const order = await create(q.id, 'key-000004');
    reported = { status: 'completed' };
    const updated = await service.refreshFromProvider('paj', `ref-${order.id}`);
    expect(updated?.status).toBe('completed');

    ramp.createOrder.mockRejectedValueOnce(
      new FiatError('PROVIDER_REFUSED', 'no', 422),
    );
    const refused = await quote(1_000);
    await expect(create(refused.id, 'key-000005')).rejects.toEqual(
      errorCode('PROVIDER_REFUSED'),
    );
    const { orders } = await service.list('ada');
    expect(orders.find((o) => o.quote.id === refused.id)?.status).toBe(
      'failed',
    );
  });

  it('acts on a PAJ callback only with its own order token', async () => {
    const q = await quote(10_000);
    const order = await create(q.id, 'key-000006');
    const url = (
      ramp.createOrder.mock.calls.at(-1)![0] as unknown as {
        webhookUrl: string;
      }
    ).webhookUrl;
    const token = url.split('/').at(-1)!;

    reported = { status: 'completed' };
    await expect(
      service.refreshFromOrderHook(order.id, '0'.repeat(40)),
    ).resolves.toBe('rejected');
    await expect(
      service.refreshFromOrderHook('someone-elses-order', token),
    ).resolves.toBe('rejected');
    const { orders: before } = await service.list('ada');
    expect(before.find((o) => o.id === order.id)?.status).toBe(
      'awaiting_payment',
    );

    const updated = await service.refreshFromOrderHook(order.id, token);
    expect(updated).not.toBe('rejected');
    expect((updated as FiatOrder).status).toBe('completed');
  });
});
