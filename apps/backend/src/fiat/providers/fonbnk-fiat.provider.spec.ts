import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { FiatRoute } from '../fiat-provider.interface';
import { FonbnkFiatProvider } from './fonbnk-fiat.provider';

const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const cryptoDetails = {
  network: 'SOLANA',
  asset: 'USDC',
  contractAddress: mint,
};
const source = {
  paymentChannel: 'bank',
  currencyType: 'fiat',
  currencyCode: 'NGN',
  currencyDetails: { countryIsoCode: 'NG' },
};
const destination = {
  paymentChannel: 'crypto',
  currencyType: 'crypto',
  currencyCode: 'SOLANA_USDC',
  currencyDetails: cryptoDetails,
};

function discovery() {
  return [source, destination].map(({ paymentChannel, ...currency }) => ({
    ...currency,
    paymentChannels: [
      {
        type: paymentChannel,
        isDepositAllowed: true,
        isPayoutAllowed: true,
        transferTypes: ['manual'],
      },
    ],
  }));
}

function limits() {
  return {
    deposit: { min: 1432, max: 715513, step: 1 },
    payout: { min: 1, max: 500, step: 0.000001 },
  };
}

function quoteFixture() {
  return {
    quoteId: 'sandbox-quote',
    quoteExpiresAt: '2099-09-08T16:24:35.556Z',
    deposit: {
      ...source,
      transferType: 'manual',
      cashout: { amountBeforeFees: 10000, totalChargedFees: 250 },
      fieldsToCreateOrder: [
        {
          key: 'phoneNumber',
          label: 'Phone Number',
          required: true,
          type: 'phone',
        },
        {
          key: 'bankCode',
          label: 'Bank',
          required: true,
          type: 'enum',
          options: [{ label: 'Sandbox Bank', value: '1' }],
        },
        {
          key: 'bankAccountNumber',
          label: 'Bank account number',
          required: true,
          type: 'string',
        },
        { key: 'depositSandboxForcedFlow', required: false, type: 'enum' },
      ],
    },
    payout: {
      ...destination,
      cashout: { amountAfterFees: 6.987995, totalChargedFees: 0 },
      fieldsToCreateOrder: [
        {
          key: 'blockchainWalletAddress',
          label: 'Wallet',
          type: 'string',
          required: true,
        },
        { key: 'payoutSandboxForcedFlow', required: false, type: 'enum' },
      ],
    },
  };
}

function route(direction: 'receive' | 'send' = 'receive'): FiatRoute {
  return {
    id: `fonbnk:${direction}`,
    direction,
    provider: 'fonbnk',
    environment: 'sandbox',
    network: 'solana',
    sourceCurrency: direction === 'receive' ? 'NGN' : 'USDC',
    destinationCurrency: direction === 'receive' ? 'USDC' : 'NGN',
    quoteAvailable: true,
    orderAvailable: false,
    accountKinds: [],
    holdsFiat: false,
    thirdPartyPayments: 'unknown',
  };
}

describe('FonbnkFiatProvider', () => {
  const fetchMock = jest.fn();
  let provider: FonbnkFiatProvider;
  let settings: Record<string, string>;
  const originalFetch = global.fetch;
  const respond = (value: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(value)),
    });
  const enqueue = (quote = quoteFixture()) => {
    respond(discovery());
    respond(limits());
    respond(quote);
  };

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    settings = {
      FONBNK_ENV: 'sandbox',
      FONBNK_CLIENT_ID: 'test-client',
      FONBNK_CLIENT_SECRET: Buffer.from('test-secret').toString('base64'),
    };
    provider = new FonbnkFiatProvider({
      get: (key: string) => settings[key],
      getOrThrow: (key: string) => settings[key],
    } as ConfigService);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('normalizes discovered routes without advertising accounts or order execution', async () => {
    respond(discovery());
    expect(await provider.routes()).toEqual([route(), route('send')]);
  });

  it('honors per-direction channel flags', async () => {
    const currencies = discovery();
    currencies[0].paymentChannels[0].isDepositAllowed = false;
    respond(currencies);
    expect(await provider.routes()).toEqual([
      { ...route(), quoteAvailable: false },
      route('send'),
    ]);
  });

  it('normalizes exact debit, credit, fees, and only consumer-editable fields', async () => {
    enqueue();
    const quote = await provider.quote(route(), '1000000');
    expect(quote.debit).toEqual({
      currency: 'NGN',
      amountMinor: '1000000',
      decimals: 2,
    });
    expect(quote.credit).toEqual({
      currency: 'USDC',
      amountMinor: '6987995',
      decimals: 6,
    });
    expect(quote.fees).toEqual([
      { currency: 'NGN', amountMinor: '25000', decimals: 2 },
      { currency: 'USDC', amountMinor: '0', decimals: 6 },
    ]);
    expect(quote.fields.map((field) => field.key)).toEqual([
      'phoneNumber',
      'bankCode',
      'bankAccountNumber',
    ]);
    expect(quote.fields[1]).toMatchObject({
      type: 'select',
      options: [{ label: 'Sandbox Bank', value: '1' }],
    });
    const [, request] = fetchMock.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(request.body as string) as {
      deposit: { amount: number };
      payout: { amount?: number };
    };
    expect(body.deposit.amount).toBe(10000);
    expect(body.payout.amount).toBeUndefined();
  });

  it('signs the exact query string and refuses redirects', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1800000000000);
    enqueue();
    await provider.quote(route(), '1000000');
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    const endpoint = url.replace('https://sandbox-api.fonbnk.com', '');
    expect(endpoint).toBe(
      '/api/v2/order-limits?depositPaymentChannel=bank&depositCurrencyType=fiat&depositCurrencyCode=NGN&depositCountryIsoCode=NG&payoutPaymentChannel=crypto&payoutCurrencyType=crypto&payoutCurrencyCode=SOLANA_USDC',
    );
    expect(options.headers).toMatchObject({
      'x-client-id': 'test-client',
      'x-timestamp': '1800000000000',
      'x-signature': createHmac('sha256', Buffer.from('test-secret'))
        .update(`1800000000000:${endpoint}`)
        .digest('base64'),
    });
    expect(options.redirect).toBe('error');
  });

  it('preserves quoted payout independently from fee arithmetic in the reverse direction', async () => {
    const quote = quoteFixture();
    const response = {
      ...quote,
      deposit: {
        ...destination,
        transferType: 'manual',
        cashout: { amountBeforeFees: 10, totalChargedFees: 0 },
        fieldsToCreateOrder: [],
      },
      payout: {
        ...source,
        cashout: {
          amountBeforeFees: 13702,
          amountAfterFees: 13359,
          totalChargedFees: 342.55,
        },
        fieldsToCreateOrder: quote.deposit.fieldsToCreateOrder,
      },
    };
    respond(discovery());
    respond({
      deposit: limits().payout,
      payout: { min: 1337, max: 667997, step: 1 },
    });
    respond(response);
    const result = await provider.quote(route('send'), '10000000');
    expect(result.credit.amountMinor).toBe('1335900');
    expect(result.fees[1].amountMinor).toBe('34255');
  });

  it.each(['production', 'disabled', ''])(
    'makes no network request in environment %s',
    async (environment) => {
      settings.FONBNK_ENV = environment;
      expect(await provider.routes()).toEqual([]);
      await expect(provider.quote(route(), '1000000')).rejects.toMatchObject({
        response: { code: 'PROVIDER_CAPABILITY_UNAVAILABLE' },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('does not advertise routes with missing credentials', async () => {
    delete settings.FONBNK_CLIENT_SECRET;
    expect(await provider.routes()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unexpected mint during discovery', async () => {
    const currencies = discovery();
    currencies[1].currencyDetails = {
      ...cryptoDetails,
      contractAddress: 'wrong-mint',
    };
    respond(currencies);
    await expect(provider.routes()).rejects.toMatchObject({
      response: { code: 'PROVIDER_INVALID_RESPONSE' },
    });
  });

  it('rejects a quote for a different mint or pair', async () => {
    const quote = quoteFixture();
    quote.payout.currencyCode = 'POLYGON_USDC';
    enqueue(quote);
    await expect(provider.quote(route(), '1000000')).rejects.toMatchObject({
      response: { code: 'PROVIDER_INVALID_RESPONSE' },
    });
  });

  it('rejects expired quotes', async () => {
    const quote = quoteFixture();
    quote.quoteExpiresAt = '2000-01-01T00:00:00Z';
    enqueue(quote);
    await expect(provider.quote(route(), '1000000')).rejects.toMatchObject({
      response: { code: 'PROVIDER_INVALID_RESPONSE' },
    });
  });

  it('rejects unavailable all-zero limits before quoting', async () => {
    respond(discovery());
    respond({ deposit: { min: 0, max: 0, step: 0 }, payout: limits().payout });
    await expect(provider.quote(route(), '1000000')).rejects.toMatchObject({
      response: { code: 'ROUTE_UNAVAILABLE' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['100', '1000001', '999999999999'])(
    'rejects outside-range or off-step amount %s',
    async (amount) => {
      respond(discovery());
      respond(limits());
      await expect(provider.quote(route(), amount)).rejects.toMatchObject({
        response: { code: 'INVALID_AMOUNT' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('rejects excess precision that JSON.parse would silently round', async () => {
    respond(discovery());
    respond(limits());
    const raw = JSON.stringify(quoteFixture()).replace(
      '6.987995',
      '6.9879950000000001',
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(raw),
    });
    await expect(provider.quote(route(), '1000000')).rejects.toMatchObject({
      response: { code: 'PROVIDER_INVALID_RESPONSE' },
    });
  });

  it('handles exponent notation without floating-point money arithmetic', async () => {
    respond(discovery());
    respond(limits());
    const raw = JSON.stringify(quoteFixture()).replace(
      '6.987995',
      '6987995e-6',
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(raw),
    });
    expect((await provider.quote(route(), '1000000')).credit.amountMinor).toBe(
      '6987995',
    );
  });

  it('fails closed when a new mandatory field cannot be represented', async () => {
    const quote = quoteFixture();
    quote.payout.fieldsToCreateOrder.push({
      key: 'identityDocument',
      label: 'ID',
      required: true,
      type: 'file',
    });
    enqueue(quote);
    await expect(provider.quote(route(), '1000000')).rejects.toMatchObject({
      response: { code: 'PROVIDER_INVALID_RESPONSE' },
    });
  });

  it('returns a safe permission error without reflecting the upstream body', async () => {
    respond({ secret: 'do-not-reflect' }, 403);
    await expect(provider.routes()).rejects.toMatchObject({
      response: { code: 'PROVIDER_CAPABILITY_UNAVAILABLE' },
    });
  });

  it('never creates or reads orders while execution is unverified', async () => {
    await expect(
      provider.createOrder(
        {} as Parameters<FonbnkFiatProvider['createOrder']>[0],
      ),
    ).rejects.toMatchObject({
      response: { code: 'PROVIDER_CAPABILITY_UNAVAILABLE' },
    });
    await expect(provider.getOrder('order')).rejects.toMatchObject({
      response: { code: 'PROVIDER_CAPABILITY_UNAVAILABLE' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
