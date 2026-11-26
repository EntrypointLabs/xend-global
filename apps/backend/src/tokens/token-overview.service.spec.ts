import { ConfigService } from '@nestjs/config';
import type { TokenPrice } from '../prices/token-price.interface';
import type { PricePoint, TokenMarket } from './token-market.interface';
import {
  CACHE_TTL_MS,
  MAX_POINTS,
  RANGE_WINDOWS,
  TOKEN_OVERVIEW_RANGES,
  TokenOverviewService,
  thin,
} from './token-overview.service';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

const SUPPORTED_BUCKETS = new Set([
  60, 300, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400, 604800,
]);

describe('TokenOverviewService', () => {
  const market = {
    getMarket: jest.fn<Promise<TokenMarket | null>, [string]>(),
  };
  const history = {
    getHistory: jest.fn<Promise<PricePoint[]>, [string, unknown]>(),
  };
  const prices = {
    getUsdPrices: jest.fn<Promise<Map<string, TokenPrice>>, [string[]]>(),
  };
  const config = new ConfigService({ EXPO_PUBLIC_USDC_MINT_ADDRESS: USDC });
  let service: TokenOverviewService;

  beforeEach(() => {
    jest.useRealTimers();
    market.getMarket.mockReset().mockResolvedValue({
      name: 'Wrapped SOL',
      symbol: 'SOL',
      iconUrl: 'https://icons/sol.webp',
      decimals: 9,
      volume24hUsd: 2_330_000_000,
    });
    history.getHistory.mockReset().mockResolvedValue([
      { at: new Date('2026-11-25T10:00:00.000Z'), priceUsd: 70.4 },
      { at: new Date('2026-11-25T10:15:00.000Z'), priceUsd: 70.2 },
    ]);
    prices.getUsdPrices
      .mockReset()
      .mockImplementation((mints) =>
        Promise.resolve(
          new Map(
            mints.map((m) => [
              m,
              { usdPrice: 70.15, priceChange24h: -0.47, decimals: 9 },
            ]),
          ),
        ),
      );
    service = new TokenOverviewService(market, history, prices, config);
  });

  it('assembles the overview', async () => {
    await expect(service.overview(SOL, '1d')).resolves.toEqual({
      mint: SOL,
      name: 'Solana',
      symbol: 'SOL',
      iconUrl: 'https://icons/sol.webp',
      decimals: 9,
      priceUsd: 70.15,
      priceChange24h: -0.47,
      volume24hUsd: 2_330_000_000,
      points: [
        { at: '2026-11-25T10:00:00.000Z', priceUsd: 70.4 },
        { at: '2026-11-25T10:15:00.000Z', priceUsd: 70.2 },
      ],
    });
  });

  it.each(TOKEN_OVERVIEW_RANGES)(
    'maps %s to a supported window of roughly 50-150 points',
    async (range) => {
      await service.overview(SOL, range);
      const window = RANGE_WINDOWS[range];
      expect(history.getHistory).toHaveBeenCalledWith(SOL, window);
      expect(SUPPORTED_BUCKETS.has(window.bucketSeconds)).toBe(true);
      expect(Math.min(window.count, MAX_POINTS)).toBeGreaterThanOrEqual(50);
    },
  );

  it('covers the span each range names', () => {
    const span = (r: keyof typeof RANGE_WINDOWS) =>
      (RANGE_WINDOWS[r].bucketSeconds * RANGE_WINDOWS[r].count) / 86_400;
    expect(span('1d')).toBe(1);
    expect(span('1w')).toBe(7);
    expect(span('1m')).toBe(30);
    expect(span('6m')).toBe(182);
    expect(span('1y')).toBeGreaterThanOrEqual(365);
  });

  it('thins a long series to at most MAX_POINTS, keeping the newest', async () => {
    const long = Array.from({ length: 182 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000),
      priceUsd: i,
    }));
    history.getHistory.mockResolvedValue(long);

    const { points } = await service.overview(SOL, '6m');
    expect(points.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(points.length).toBeGreaterThanOrEqual(50);
    expect(points[points.length - 1].priceUsd).toBe(181);
    expect(points.map((p) => p.priceUsd)).toEqual(
      [...points.map((p) => p.priceUsd)].sort((a, b) => a - b),
    );
  });

  it('leaves thin() alone under the cap', () => {
    expect(thin([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(thin([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 4, 7]);
  });

  it('nulls every field a provider could not source', async () => {
    market.getMarket.mockRejectedValue(new Error('down'));
    prices.getUsdPrices.mockResolvedValue(new Map());
    history.getHistory.mockRejectedValue(new Error('down'));

    await expect(service.overview(BONK, '1w')).resolves.toEqual({
      mint: BONK,
      name: null,
      symbol: null,
      iconUrl: null,
      decimals: null,
      priceUsd: null,
      priceChange24h: null,
      volume24hUsd: null,
      points: [],
    });
  });

  it('names a configured stablecoin the index does not know', async () => {
    market.getMarket.mockResolvedValue(null);
    history.getHistory.mockResolvedValue([]);
    prices.getUsdPrices.mockResolvedValue(
      new Map([[USDC, { usdPrice: 1, priceChange24h: null, decimals: 6 }]]),
    );

    await expect(service.overview(USDC, '1d')).resolves.toMatchObject({
      name: null,
      symbol: 'USDC',
      decimals: 6,
      priceUsd: 1,
      priceChange24h: null,
      points: [],
    });
  });

  it('serves a repeat open from cache within the TTL', async () => {
    await service.overview(SOL, '1d');
    await service.overview(SOL, '1d');
    expect(history.getHistory).toHaveBeenCalledTimes(1);
    expect(market.getMarket).toHaveBeenCalledTimes(1);
  });

  it('caches the chart per range and the market per mint', async () => {
    await service.overview(SOL, '1d');
    await service.overview(SOL, '1w');
    expect(history.getHistory).toHaveBeenCalledTimes(2);
    expect(market.getMarket).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL lapses', async () => {
    jest.useFakeTimers({ now: Date.UTC(2026, 10, 26) });
    await service.overview(SOL, '1d');
    jest.setSystemTime(Date.UTC(2026, 10, 26) + CACHE_TTL_MS + 1);
    await service.overview(SOL, '1d');
    expect(history.getHistory).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('does not cache a failed market lookup', async () => {
    market.getMarket.mockRejectedValueOnce(new Error('down'));
    expect((await service.overview(SOL, '1d')).volume24hUsd).toBeNull();
    expect((await service.overview(SOL, '1d')).volume24hUsd).toBe(
      2_330_000_000,
    );
    expect(market.getMarket).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed chart', async () => {
    history.getHistory.mockRejectedValueOnce(new Error('down'));
    const first = await service.overview(SOL, '1d');
    expect(first.points).toEqual([]);

    const second = await service.overview(SOL, '1d');
    expect(second.points).toHaveLength(2);
    expect(history.getHistory).toHaveBeenCalledTimes(2);
  });
});
