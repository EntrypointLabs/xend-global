import { Injectable, Logger } from '@nestjs/common';

import type {
  SwapToken,
  SwapTokenCategory,
  SwapTokenDirectory,
  SwapTokenTrust,
} from './swap-tokens.interface';

const TOKENS_API = 'https://lite-api.jup.ag/tokens/v2';
const REQUEST_TIMEOUT_MS = 4_000;
const LIST_LENGTH = 30;

/** The most the ranking gives in one call, split across the categories. */
const RANKING_LENGTH = 100;

/** Rankings move slowly; a search result for a ticker moves slower still. */
const POPULAR_TTL_MS = 5 * 60 * 1000;
const SEARCH_TTL_MS = 60 * 1000;
const SEARCH_CACHE_SIZE = 500;

const STOCK_TAGS = ['stocks', 'xstocks', 'equities', 'prestocks', 'pre-ipo'];

interface JupiterToken {
  id?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  isVerified?: boolean;
  usdPrice?: number;
  tags?: string[];
  launchpad?: string;
  audit?: { isSus?: boolean };
}

interface Cached {
  tokens: SwapToken[];
  cachedAt: number;
}

/** Jupiter's verified tokens, ranked by how much real trading they see. */
@Injectable()
export class JupiterSwapTokensAdapter implements SwapTokenDirectory {
  private readonly logger = new Logger(JupiterSwapTokensAdapter.name);
  private ranking: Cached | null = null;
  private readonly searches = new Map<string, Cached>();

  async popular(category?: SwapTokenCategory): Promise<SwapToken[]> {
    const ranked = await this.ranked();
    const shelf = category ?? 'crypto';
    return ranked
      .filter((token) => token.category === shelf)
      .slice(0, LIST_LENGTH);
  }

  async search(query: string): Promise<SwapToken[]> {
    const key = query.trim().toLowerCase();
    if (!key) return this.popular();
    const cached = this.searches.get(key);
    if (cached && Date.now() - cached.cachedAt < SEARCH_TTL_MS) {
      return cached.tokens;
    }
    const [found, ranked] = await Promise.all([
      this.fetchTokens(`/search?query=${encodeURIComponent(key)}`),
      this.ranked(),
    ]);
    const tokens = markCopies(found, ranked).slice(0, LIST_LENGTH);
    if (this.searches.size >= SEARCH_CACHE_SIZE) this.searches.clear();
    this.searches.set(key, { tokens, cachedAt: Date.now() });
    return tokens;
  }

  private async ranked(): Promise<SwapToken[]> {
    const cached = this.ranking;
    if (cached && Date.now() - cached.cachedAt < POPULAR_TTL_MS) {
      return cached.tokens;
    }
    try {
      const tokens = (
        await this.fetchTokens(`/toporganicscore/24h?limit=${RANKING_LENGTH}`)
      ).filter((token) => token.trust === 'verified');
      this.ranking = { tokens, cachedAt: Date.now() };
      return tokens;
    } catch (err) {
      this.logger.warn('swap.tokens.ranking_unavailable', err);
      // An old ranking is still a list of real tokens.
      return cached?.tokens ?? [];
    }
  }

  private async fetchTokens(path: string): Promise<SwapToken[]> {
    const response = await fetch(`${TOKENS_API}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const listed = (await response.json()) as JupiterToken[];
    const tokens: SwapToken[] = [];
    for (const token of Array.isArray(listed) ? listed : []) {
      if (!token.id || !token.symbol || typeof token.decimals !== 'number') {
        continue;
      }
      tokens.push({
        mint: token.id,
        symbol: token.symbol,
        name: token.name ?? token.symbol,
        decimals: token.decimals,
        iconUrl: token.icon ?? null,
        category: categoryOf(token),
        trust: trustOf(token),
        usdPrice:
          typeof token.usdPrice === 'number' && token.usdPrice > 0
            ? token.usdPrice
            : null,
      });
    }
    return tokens;
  }
}

function trustOf(token: JupiterToken): SwapTokenTrust {
  if (token.isVerified === true) return 'verified';
  return token.audit?.isSus === true ? 'caution' : 'unverified';
}

/**
 * Marks an unverified token that carries a verified token's ticker. Checked
 * against the ranking as well as the results, because a search for a copy's
 * exact address returns the copy alone.
 */
function markCopies(found: SwapToken[], ranked: SwapToken[]): SwapToken[] {
  const taken = new Set(
    [...found, ...ranked]
      .filter((token) => token.trust === 'verified')
      .map((token) => token.symbol.toLowerCase()),
  );
  return found.map((token) =>
    token.trust === 'unverified' && taken.has(token.symbol.toLowerCase())
      ? { ...token, trust: 'caution' }
      : token,
  );
}

/**
 * Which shelf a token belongs on, from the source's own labels.
 *
 * A token minted on a launchpad and labelled nothing else is shelved with the
 * meme tokens. Most of them are, and the cost of being wrong is a token
 * listed one tap further away, where the other reading would put a day-old
 * coin beside SOL in the everyday list.
 */
function categoryOf(token: JupiterToken): SwapTokenCategory {
  const tags = token.tags ?? [];
  if (STOCK_TAGS.some((tag) => tags.includes(tag))) return 'stocks';
  if (tags.includes('meme')) return 'meme';
  if (token.launchpad && !tags.includes('defi')) return 'meme';
  return 'crypto';
}
