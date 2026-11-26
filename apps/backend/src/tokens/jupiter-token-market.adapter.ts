import { Injectable } from '@nestjs/common';
import type {
  TokenMarket,
  TokenMarketProvider,
} from './token-market.interface';

const SEARCH_ENDPOINT = 'https://lite-api.jup.ag/tokens/v2/search';

const REQUEST_TIMEOUT_MS = 4_000;

interface JupiterVolumeStats {
  buyVolume?: number;
  sellVolume?: number;
}

interface JupiterToken {
  id?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  stats24h?: JupiterVolumeStats;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The same search the metadata adapter uses, read for its 24h stats too. */
@Injectable()
export class JupiterTokenMarketAdapter implements TokenMarketProvider {
  async getMarket(mint: string): Promise<TokenMarket | null> {
    const res = await fetch(
      `${SEARCH_ENDPOINT}?query=${encodeURIComponent(mint)}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`jupiter token search failed: ${res.status}`);

    const body = (await res.json()) as unknown;
    // A search, not a lookup: other tokens can match the query text, so only
    // an exact id match counts.
    const token = (Array.isArray(body) ? (body as JupiterToken[]) : []).find(
      (t) => t?.id === mint,
    );
    if (!token) return null;

    const stats = token.stats24h;
    const volume =
      stats && (finite(stats.buyVolume) || finite(stats.sellVolume))
        ? (finite(stats.buyVolume) ? stats.buyVolume : 0) +
          (finite(stats.sellVolume) ? stats.sellVolume : 0)
        : null;

    return {
      name: token.name || null,
      symbol: token.symbol || null,
      iconUrl: token.icon || null,
      decimals:
        typeof token.decimals === 'number' && Number.isInteger(token.decimals)
          ? token.decimals
          : null,
      volume24hUsd: volume,
    };
  }
}
