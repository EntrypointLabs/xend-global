import { Injectable, Logger } from '@nestjs/common';
import type { TokenPrice, TokenPriceProvider } from './token-price.interface';

/**
 * Keyless public price endpoint. Keyed by mint, which is what a balance read
 * already has, so no symbol resolution step is needed.
 */
const PRICE_ENDPOINT = 'https://lite-api.jup.ag/price/v3';

const REQUEST_TIMEOUT_MS = 4_000;

/**
 * How long a quote is reused.
 *
 * Short, because this is a price. Long enough that indexing a burst of
 * transfers costs one lookup rather than one per transfer, which is what puts
 * this on the webhook hot path at all.
 */
const CACHE_TTL_MS = 60_000;

interface JupiterPriceEntry {
  usdPrice?: number;
  priceChange24h?: number;
  decimals?: number;
}

interface CacheEntry {
  price: TokenPrice;
  cachedAt: number;
}

/**
 * Prices mints against Jupiter.
 *
 * Note this prices MAINNET markets regardless of the cluster the rest of the
 * app talks to, because that is where the liquidity that sets a price lives.
 * Wrapped SOL shares one mint address across clusters so it resolves either
 * way; a devnet-only mint (devnet USDC, say) has no market and simply comes
 * back unpriced, which is why stablecoins are pinned rather than looked up.
 */
@Injectable()
export class JupiterPriceAdapter implements TokenPriceProvider {
  private readonly logger = new Logger(JupiterPriceAdapter.name);
  private readonly cache = new Map<string, CacheEntry>();

  async getUsdPrices(mints: string[]): Promise<Map<string, TokenPrice>> {
    const prices = new Map<string, TokenPrice>();
    if (mints.length === 0) return prices;

    const now = Date.now();
    const stale: string[] = [];
    for (const mint of mints) {
      const entry = this.cache.get(mint);
      if (entry && now - entry.cachedAt < CACHE_TTL_MS) {
        prices.set(mint, entry.price);
        continue;
      }
      stale.push(mint);
    }
    if (stale.length === 0) return prices;

    // Bounded: a balance read must not hang on a third party that is having a
    // bad day. A timeout here degrades to an unpriced holding, not a 30s spin.
    const res = await fetch(
      `${PRICE_ENDPOINT}?ids=${encodeURIComponent(stale.join(','))}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (!res.ok) {
      throw new Error(`jupiter price lookup failed: ${res.status}`);
    }

    const body = (await res.json()) as Record<string, JupiterPriceEntry | null>;
    for (const [mint, entry] of Object.entries(body)) {
      const price = entry?.usdPrice;
      // Rejecting non-finite and negative prices rather than trusting the
      // shape: this is an unversioned public endpoint read off live responses.
      if (typeof price === 'number' && Number.isFinite(price) && price >= 0) {
        const change = entry?.priceChange24h;
        const quoted: TokenPrice = {
          usdPrice: price,
          priceChange24h:
            typeof change === 'number' && Number.isFinite(change)
              ? change
              : null,
          decimals: typeof entry?.decimals === 'number' ? entry.decimals : null,
        };
        prices.set(mint, quoted);
        this.cache.set(mint, { price: quoted, cachedAt: now });
      }
    }

    this.logger.debug(
      `prices.jupiter requested=${mints.length} fetched=${stale.length} priced=${prices.size}`,
    );
    return prices;
  }
}
