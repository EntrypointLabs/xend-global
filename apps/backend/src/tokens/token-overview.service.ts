import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TOKEN_PRICE_PROVIDER } from '../prices/token-price.interface';
import type {
  TokenPrice,
  TokenPriceProvider,
} from '../prices/token-price.interface';
import { WRAPPED_SOL_MINT } from '../solana/web3-connection';
import {
  TOKEN_MARKET_PROVIDER,
  TOKEN_PRICE_HISTORY_PROVIDER,
} from './token-market.interface';
import type {
  HistoryWindow,
  PricePoint,
  TokenMarket,
  TokenMarketProvider,
  TokenPriceHistoryProvider,
} from './token-market.interface';

export const TOKEN_OVERVIEW_RANGES = ['1d', '1w', '1m', '6m', '1y'] as const;
export type TokenOverviewRange = (typeof TOKEN_OVERVIEW_RANGES)[number];

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RANGE_WINDOWS: Record<TokenOverviewRange, HistoryWindow> = {
  '1d': { bucketSeconds: 15 * MINUTE, count: 96 },
  '1w': { bucketSeconds: 2 * HOUR, count: 84 },
  '1m': { bucketSeconds: 8 * HOUR, count: 90 },
  '6m': { bucketSeconds: DAY, count: 182 },
  '1y': { bucketSeconds: 7 * DAY, count: 53 },
};

/** A phone chart gains nothing past this; the rest is payload. */
export const MAX_POINTS = 150;

export const CACHE_TTL_MS = 2 * 60_000;

const MAX_CACHE_ENTRIES = 1_000;

export interface TokenOverview {
  mint: string;
  name: string | null;
  symbol: string | null;
  iconUrl: string | null;
  decimals: number | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  volume24hUsd: number | null;
  points: { at: string; priceUsd: number }[];
}

type LocalToken = Partial<Pick<TokenMarket, 'name' | 'symbol' | 'decimals'>>;

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

/**
 * Remembers successful loads only, so a provider outage is retried on the
 * next open rather than served for a whole TTL.
 */
class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.cachedAt < CACHE_TTL_MS) return hit.value;

    const value = await load();
    this.entries.delete(key);
    if (this.entries.size >= MAX_CACHE_ENTRIES) {
      const [oldest] = this.entries.keys();
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, cachedAt: now });
    return value;
  }
}

/** Keeps the newest point and every stride-th one before it. */
export function thin<T>(points: T[], max = MAX_POINTS): T[] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const kept: T[] = [];
  for (let i = points.length - 1; i >= 0; i -= stride) kept.push(points[i]);
  return kept.reverse();
}

@Injectable()
export class TokenOverviewService {
  private readonly logger = new Logger(TokenOverviewService.name);
  // Market data is per mint, so flipping between ranges only costs a chart.
  private readonly markets = new TtlCache<TokenMarket | null>();
  private readonly charts = new TtlCache<PricePoint[]>();

  constructor(
    @Inject(TOKEN_MARKET_PROVIDER)
    private readonly market: TokenMarketProvider,
    @Inject(TOKEN_PRICE_HISTORY_PROVIDER)
    private readonly history: TokenPriceHistoryProvider,
    @Inject(TOKEN_PRICE_PROVIDER)
    private readonly prices: TokenPriceProvider,
    private readonly config: ConfigService,
  ) {}

  async overview(
    mint: string,
    range: TokenOverviewRange,
  ): Promise<TokenOverview> {
    const settle = async <T>(what: string, work: Promise<T>, fallback: T) => {
      try {
        return await work;
      } catch (err) {
        this.logger.warn(
          `tokens.overview.${what}.unavailable mint=${mint}`,
          err,
        );
        return fallback;
      }
    };

    const local = this.localTokens().get(mint) ?? {};
    const [market, prices, points] = await Promise.all([
      settle(
        'market',
        this.markets.get(mint, () => this.market.getMarket(mint)),
        null,
      ),
      settle(
        'price',
        this.prices.getUsdPrices([mint]),
        new Map<string, TokenPrice>(),
      ),
      settle(
        'history',
        this.charts.get(`${mint}:${range}`, () =>
          this.history.getHistory(mint, RANGE_WINDOWS[range]),
        ),
        [],
      ),
    ]);

    const price = prices.get(mint);
    const overview: TokenOverview = {
      mint,
      // Native SOL is what a Consumer holds; the index names the wrapped mint.
      name: local.name ?? market?.name ?? null,
      symbol: market?.symbol ?? local.symbol ?? null,
      iconUrl: market?.iconUrl ?? null,
      decimals: market?.decimals ?? local.decimals ?? price?.decimals ?? null,
      priceUsd: price?.usdPrice ?? null,
      priceChange24h: price?.priceChange24h ?? null,
      volume24hUsd: market?.volume24hUsd ?? null,
      points: thin(points).map((p) => ({
        at: p.at.toISOString(),
        priceUsd: p.priceUsd,
      })),
    };

    return overview;
  }

  /**
   * What this deployment knows without asking. On a test network the cluster's
   * stablecoins are exactly the mints the index has never heard of.
   */
  private localTokens(): Map<string, LocalToken> {
    const tokens = new Map<string, LocalToken>([
      [WRAPPED_SOL_MINT, { name: 'Solana', symbol: 'SOL', decimals: 9 }],
    ]);
    const usdc = this.config.get<string>('EXPO_PUBLIC_USDC_MINT_ADDRESS');
    const usdt = this.config.get<string>('EXPO_PUBLIC_USDT_MINT_ADDRESS');
    if (usdc) tokens.set(usdc, { symbol: 'USDC', decimals: 6 });
    if (usdt) tokens.set(usdt, { symbol: 'USDT', decimals: 6 });
    return tokens;
  }
}
