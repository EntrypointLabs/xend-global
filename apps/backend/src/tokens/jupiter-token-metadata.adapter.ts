import { Injectable, Logger } from '@nestjs/common';
import type {
  TokenMetadata,
  TokenMetadataProvider,
} from './token-metadata.interface';

/** Keyed by mint, which is the only identifier a balance read has. */
const SEARCH_ENDPOINT = 'https://lite-api.jup.ag/tokens/v2/search';

const REQUEST_TIMEOUT_MS = 4_000;

/**
 * How long a mint's name and logo are trusted.
 *
 * Long, because this is the one thing about a token that does not move. The
 * cache exists so a balance read never waits on a third party to be told that
 * SOL is called Solana.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface JupiterToken {
  id?: string;
  name?: string;
  symbol?: string;
  icon?: string;
}

interface CacheEntry {
  metadata: TokenMetadata | null;
  cachedAt: number;
}

/**
 * Names and logos from Jupiter's token search.
 *
 * Chosen over a coin-list API because it is keyed by MINT ADDRESS, which is
 * what a balance read already holds; the alternatives key by their own coin
 * ids and would need a mint-to-id mapping maintained by hand for every asset
 * ever added.
 *
 * It indexes mainnet, so a devnet-only mint resolves to nothing. That is
 * recorded as a negative cache entry rather than retried on every read, and
 * the client falls back to what it knows locally.
 */
@Injectable()
export class JupiterTokenMetadataAdapter implements TokenMetadataProvider {
  private readonly logger = new Logger(JupiterTokenMetadataAdapter.name);
  private readonly cache = new Map<string, CacheEntry>();

  async getMetadata(mints: string[]): Promise<Map<string, TokenMetadata>> {
    const found = new Map<string, TokenMetadata>();
    if (mints.length === 0) return found;

    const now = Date.now();
    const missing: string[] = [];
    for (const mint of mints) {
      const entry = this.cache.get(mint);
      if (entry && now - entry.cachedAt < CACHE_TTL_MS) {
        // A null entry is a remembered miss: the source does not know this
        // mint, and asking again every few seconds will not change that.
        if (entry.metadata) found.set(mint, entry.metadata);
        continue;
      }
      missing.push(mint);
    }
    if (missing.length === 0) return found;

    let tokens: JupiterToken[];
    try {
      const res = await fetch(
        `${SEARCH_ENDPOINT}?query=${encodeURIComponent(missing.join(','))}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      tokens = (await res.json()) as JupiterToken[];
    } catch (err) {
      // Metadata is decoration. A balance must still render without it, so
      // this degrades to "no name, no logo" rather than failing the read.
      this.logger.warn(
        `tokens.metadata.unavailable mints=${missing.length}`,
        err,
      );
      return found;
    }

    for (const token of Array.isArray(tokens) ? tokens : []) {
      if (!token.id) continue;
      const metadata: TokenMetadata = {
        name: token.name ?? token.symbol ?? '',
        symbol: token.symbol ?? '',
        iconUrl: token.icon ?? null,
      };
      found.set(token.id, metadata);
      this.cache.set(token.id, { metadata, cachedAt: now });
    }

    // Remember the misses too, so an unknown mint costs one lookup per TTL
    // rather than one per balance read.
    for (const mint of missing) {
      if (!found.has(mint))
        this.cache.set(mint, { metadata: null, cachedAt: now });
    }

    return found;
  }
}
