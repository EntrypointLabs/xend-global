import { NombaAdapter } from './nomba.adapter';

const now = Date.parse('2026-09-09T22:00:00.000Z');
const rate = {
  currencyPairName: 'NGN/USD',
  createdAt: new Date(now).toISOString(),
};
const quote = {
  fromAmount: 1500,
  fromCurrency: 'NGN',
  toAmount: 1,
  toCurrency: 'USD',
  exchangeRateId: 'rate-1',
};
function setup(rateResponse: unknown = rate, quoteResponse: unknown = quote) {
  const transport = jest
    .fn<Promise<Response>, [string, RequestInit]>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: '00', data: { rates: [rateResponse] } }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: '00', data: quoteResponse })),
    );
  const adapter = new NombaAdapter(
    {
      senderName: 'Xend',
      accountId: 'sandbox-account',
      accessToken: 'sandbox-token',
    },
    transport,
  );
  return { adapter, transport };
}
describe('Nomba indicative USD fiat valuation', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it('binds explicit amounts and authenticates both quote-only requests without authorizing settlement', async () => {
    const { adapter, transport } = setup();
    expect(await adapter.quoteNgnUsd('150000')).toEqual({
      debitNgnMinor: '150000',
      creditUsdMinor: '100',
      environment: 'sandbox',
      evidence: 'fixture',
      observedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      'https://sandbox.nomba.com/v1/global-payout/exchange-rates?from=NGN&to=USD',
      'https://sandbox.nomba.com/v1/global-payout/money/convert',
    ]);
    expect(transport.mock.calls[1][1].headers).toMatchObject({
      Authorization: 'Bearer sandbox-token',
      accountId: 'sandbox-account',
    });
    expect(JSON.parse(transport.mock.calls[1][1].body as string)).toEqual({
      amount: 1500,
      currency: 'NGN',
      destinationCurrency: 'USD',
      transactionType: 'EXCHANGE',
    });
  });
  it('refuses anonymous fixtures for balance valuation', async () => {
    const transport = jest.fn();
    await expect(
      new NombaAdapter({ senderName: 'Xend' }, transport).quoteNgnUsd('150000'),
    ).rejects.toThrow('NOMBA_AUTH_REQUIRED');
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { ...rate, currencyPairName: 'EUR/USD' },
    { ...rate, createdAt: 'invalid' },
    { ...rate, createdAt: new Date(now - 300_000).toISOString() },
    { ...rate, createdAt: new Date(now + 5_001).toISOString() },
  ])(
    'rejects mismatched, invalid, stale or future rate evidence',
    async (rateResponse) => {
      const { adapter, transport } = setup(rateResponse);
      await expect(adapter.quoteNgnUsd('150000')).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { ...quote, fromAmount: 1499 },
    { ...quote, fromCurrency: 'USD' },
    { ...quote, toCurrency: 'USDC' },
    { ...quote, toAmount: 0 },
    { ...quote, toAmount: -1 },
    { ...quote, toAmount: '1.001' },
  ])(
    'rejects mismatched or invalid conversion amounts',
    async (quoteResponse) => {
      await expect(
        setup(rate, quoteResponse).adapter.quoteNgnUsd('150000'),
      ).rejects.toThrow();
    },
  );
  it('rechecks rate expiry after the quote response', async () => {
    const { adapter } = setup();
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 300_000);
    await expect(adapter.quoteNgnUsd('150000')).rejects.toThrow(
      'NOMBA_STALE_RATE',
    );
  });
});
