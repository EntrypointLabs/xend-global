import type { TokenPriceProvider } from './token-price.interface';

/**
 * What an amount of a token is worth in dollars at today's price, as a
 * six-place decimal string, or null when the mint cannot be priced or its
 * decimals are unknown, because a raw amount without decimals is not a
 * quantity yet.
 *
 * The decimals given win over the quote's: they come from the chain or the
 * transfer itself and are present even for mints no price index lists.
 *
 * Throws when the price source does; the caller decides whether a missing
 * value is worth more than the write it accompanies.
 */
export async function usdValueOf(
  prices: TokenPriceProvider,
  mint: string,
  amountRaw: bigint,
  decimals: number | null,
): Promise<string | null> {
  const quote = (await prices.getUsdPrices([mint])).get(mint);
  const places = decimals ?? quote?.decimals ?? null;
  if (!quote || places === null) return null;

  const divisor = 10n ** BigInt(places);
  const whole = Number(amountRaw / divisor);
  const fraction = Number(amountRaw % divisor) / Number(divisor);
  return ((whole + fraction) * quote.usdPrice).toFixed(6);
}
