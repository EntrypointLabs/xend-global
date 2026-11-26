import { JupiterPriceHistoryAdapter } from './jupiter-price-history.adapter';

const SOL = 'So11111111111111111111111111111111111111112';

describe('JupiterPriceHistoryAdapter', () => {
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

  it('asks for the interval and count the window names', async () => {
    respond({ candles: [] });
    await new JupiterPriceHistoryAdapter().getHistory(SOL, {
      bucketSeconds: 15 * 60,
      count: 96,
    });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe(`/v2/charts/${SOL}`);
    expect(url.searchParams.get('interval')).toBe('15_MINUTE');
    expect(url.searchParams.get('candles')).toBe('96');
    expect(url.searchParams.get('type')).toBe('price');
    expect(Number(url.searchParams.get('to'))).toBeGreaterThan(0);
  });

  it('returns closes ascending and drops malformed candles', async () => {
    respond({
      candles: [
        { time: 1_795_640_400, close: 70.5 },
        { time: 1_795_636_800, close: 70.1 },
        { time: 1_795_644_000, close: Number.NaN },
        { time: 1_795_647_600, close: -1 },
        { close: 71 },
      ],
    });

    const points = await new JupiterPriceHistoryAdapter().getHistory(SOL, {
      bucketSeconds: 3600,
      count: 5,
    });

    expect(points).toEqual([
      { at: new Date(1_795_636_800_000), priceUsd: 70.1 },
      { at: new Date(1_795_640_400_000), priceUsd: 70.5 },
    ]);
  });

  it('returns nothing for a mint with no market', async () => {
    respond({ candles: [] });
    await expect(
      new JupiterPriceHistoryAdapter().getHistory(SOL, {
        bucketSeconds: 3600,
        count: 24,
      }),
    ).resolves.toEqual([]);
  });

  it('throws on a non-2xx', async () => {
    respond({}, 503);
    await expect(
      new JupiterPriceHistoryAdapter().getHistory(SOL, {
        bucketSeconds: 3600,
        count: 24,
      }),
    ).rejects.toThrow('503');
  });

  it('refuses a bucket the provider does not offer', async () => {
    await expect(
      new JupiterPriceHistoryAdapter().getHistory(SOL, {
        bucketSeconds: 3 * 3600,
        count: 24,
      }),
    ).rejects.toThrow('unsupported bucket');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
