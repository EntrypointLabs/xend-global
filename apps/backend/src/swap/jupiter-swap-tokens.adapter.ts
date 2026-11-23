import { Injectable, Logger } from '@nestjs/common';

import type { SwapToken, SwapTokenDirectory } from './swap-tokens.interface';

const TOKENS_API = 'https://lite-api.jup.ag/tokens/v2';
const REQUEST_TIMEOUT_MS = 4_000;
const LIST_LENGTH = 30;

/** Rankings move slowly; a search result for a ticker moves slower still. */
const POPULAR_TTL_MS = 5 * 60 * 1000;
const SEARCH_TTL_MS = 60 * 1000;
const SEARCH_CACHE_SIZE = 500;

interface JupiterToken {
  id?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  isVerified?: boolean;
}

interface Cached {
  tokens: SwapToken[];
  cachedAt: number;
}

/** Jupiter's verified tokens, ranked by how much real trading they see. */
@Injectable()
export class JupiterSwapTokensAdapter implements SwapTokenDirectory {
  private readonly logger = new Logger(JupiterSwapTokensAdapter.name);
  private popularCache: Cached | null = null;
  private readonly searches = new Map<string, Cached>();

  async popular(): Promise<SwapToken[]> {
    const cached = this.popularCache;
    if (cached && Date.now() - cached.cachedAt < POPULAR_TTL_MS) {
      return cached.tokens;
    }
    try {
      // Asked for more than is shown, because the unverified ones are dropped.
      const tokens = await this.fetchVerified(
        `/toporganicscore/24h?limit=${LIST_LENGTH * 2}`,
      );
      this.popularCache = { tokens, cachedAt: Date.now() };
      return tokens;
    } catch (err) {
      this.logger.warn('swap.tokens.popular_unavailable', err);
      // An old ranking is still a list of real tokens.
      return cached?.tokens ?? [];
    }
  }

  async search(query: string): Promise<SwapToken[]> {
    const key = query.trim().toLowerCase();
    if (!key) return this.popular();
    const cached = this.searches.get(key);
    if (cached && Date.now() - cached.cachedAt < SEARCH_TTL_MS) {
      return cached.tokens;
    }
    const tokens = await this.fetchVerified(
      `/search?query=${encodeURIComponent(key)}`,
    );
    if (this.searches.size >= SEARCH_CACHE_SIZE) this.searches.clear();
    this.searches.set(key, { tokens, cachedAt: Date.now() });
    return tokens;
  }

  private async fetchVerified(path: string): Promise<SwapToken[]> {
    const response = await fetch(`${TOKENS_API}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const listed = (await response.json()) as JupiterToken[];
    const tokens: SwapToken[] = [];
    for (const token of Array.isArray(listed) ? listed : []) {
      if (
        token.isVerified !== true ||
        !token.id ||
        !token.symbol ||
        typeof token.decimals !== 'number'
      ) {
        continue;
      }
      tokens.push({
        mint: token.id,
        symbol: token.symbol,
        name: token.name ?? token.symbol,
        decimals: token.decimals,
        iconUrl: token.icon ?? null,
      });
      if (tokens.length === LIST_LENGTH) break;
    }
    return tokens;
  }
}
