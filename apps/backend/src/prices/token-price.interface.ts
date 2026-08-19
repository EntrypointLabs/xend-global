/** DI token for the active token price provider. */
export const TOKEN_PRICE_PROVIDER = Symbol('TokenPriceProvider');

export interface TokenPrice {
  /** USD per whole token. */
  usdPrice: number;
  /**
   * Percent change over the last 24 hours, or null when the source does not
   * report one. Null rather than 0 so "flat" and "unknown" stay distinct: only
   * one of them should be shown to a Consumer as a number.
   */
  priceChange24h: number | null;
  /**
   * The mint's decimals.
   *
   * Carried with the price because a raw on-chain amount cannot be turned
   * into a dollar figure without it, and the caller valuing a transfer has
   * the raw amount and nothing else.
   */
  decimals: number | null;
}

export interface TokenPriceProvider {
  /**
   * Prices keyed by mint.
   *
   * Mints the provider cannot price are ABSENT from the map rather than zero:
   * "we do not know what this is worth" and "this is worth nothing" lead to
   * different numbers on a Consumer's balance, and only one of them is safe to
   * add up.
   */
  getUsdPrices(mints: string[]): Promise<Map<string, TokenPrice>>;
}
