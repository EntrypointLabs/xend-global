import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JupiterPriceAdapter } from './jupiter-price.adapter';
import type { TokenPrice, TokenPriceProvider } from './token-price.interface';

/** Every USD stablecoin this app deals in is a six-decimal mint. */
const STABLECOIN_DECIMALS = 6;

/**
 * The active TOKEN_PRICE_PROVIDER: a dollar is a dollar, everything else is
 * quoted.
 *
 * Pinning lives here rather than in one caller so that a balance and an
 * activity row cannot disagree about what 20 USDC is worth. Two reasons to pin
 * rather than quote:
 *
 *   - The cluster's USDC has no market to quote on a test network, so it comes
 *     back unpriced and a Consumer's cash balance reads as nothing.
 *   - On mainnet a real 0.9997 quote would render a 20 USDC balance as $19.99
 *     in the one place a Consumer expects the number to be exact.
 *
 * A depeg is therefore invisible here by design. If that ever needs to show,
 * it belongs in a separate signal, not in the spending balance.
 */
@Injectable()
export class PinnedStablecoinPriceProvider implements TokenPriceProvider {
  constructor(
    private readonly quoted: JupiterPriceAdapter,
    private readonly config: ConfigService,
  ) {}

  async getUsdPrices(mints: string[]): Promise<Map<string, TokenPrice>> {
    const pinned = this.stablecoinMints();
    const prices = new Map<string, TokenPrice>();

    for (const mint of mints) {
      if (!pinned.has(mint)) continue;
      prices.set(mint, {
        usdPrice: 1,
        // A pinned dollar reports no movement, which is not the same as
        // having moved zero percent.
        priceChange24h: null,
        decimals: STABLECOIN_DECIMALS,
      });
    }

    const rest = mints.filter((mint) => !prices.has(mint));
    if (rest.length === 0) return prices;

    try {
      for (const [mint, price] of await this.quoted.getUsdPrices(rest)) {
        prices.set(mint, price);
      }
    } catch {
      // A dollar is still a dollar when an unrelated asset cannot be quoted.
      // Letting the rejection through discarded the pinned entries too, so an
      // outage in one mint erased the Consumer's cash balance.
    }
    return prices;
  }

  /** The mints this deployment treats as worth exactly one dollar. */
  private stablecoinMints(): Set<string> {
    return new Set(
      [
        this.config.getOrThrow<string>('EXPO_PUBLIC_USDC_MINT_ADDRESS'),
        this.config.get<string>('EXPO_PUBLIC_USDT_MINT_ADDRESS'),
      ].filter((mint): mint is string => Boolean(mint)),
    );
  }
}
