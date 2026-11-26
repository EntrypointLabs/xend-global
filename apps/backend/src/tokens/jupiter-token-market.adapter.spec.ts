import { JupiterTokenMarketAdapter } from './jupiter-token-market.adapter';

const SOL = 'So11111111111111111111111111111111111111112';

describe('JupiterTokenMarketAdapter', () => {
  const fetchMock = jest.fn<Promise<unknown>, [string]>();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const respond = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });

  it('reads the exact mint and sums both sides of 24h volume', async () => {
    respond([
      { id: 'other', name: 'Other', symbol: 'SOL' },
      {
        id: SOL,
        name: 'Wrapped SOL',
        symbol: 'SOL',
        icon: 'https://icons/sol.webp',
        decimals: 9,
        stats24h: { buyVolume: 1_100_000_000, sellVolume: 1_200_000_000 },
      },
    ]);

    await expect(
      new JupiterTokenMarketAdapter().getMarket(SOL),
    ).resolves.toEqual({
      name: 'Wrapped SOL',
      symbol: 'SOL',
      iconUrl: 'https://icons/sol.webp',
      decimals: 9,
      volume24hUsd: 2_300_000_000,
    });
    expect(fetchMock.mock.calls[0][0]).toContain(`query=${SOL}`);
  });

  it('leaves what the source does not report as null', async () => {
    respond([{ id: SOL }]);
    await expect(
      new JupiterTokenMarketAdapter().getMarket(SOL),
    ).resolves.toEqual({
      name: null,
      symbol: null,
      iconUrl: null,
      decimals: null,
      volume24hUsd: null,
    });
  });

  it('returns null when only other tokens match', async () => {
    respond([{ id: 'other' }]);
    await expect(new JupiterTokenMarketAdapter().getMarket(SOL)).resolves.toBe(
      null,
    );
  });

  it('throws on a non-2xx', async () => {
    respond({}, 429);
    await expect(
      new JupiterTokenMarketAdapter().getMarket(SOL),
    ).rejects.toThrow('429');
  });
});
