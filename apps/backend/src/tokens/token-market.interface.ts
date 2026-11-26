/** DI token for the active price history provider. */
export const TOKEN_PRICE_HISTORY_PROVIDER = Symbol('TokenPriceHistoryProvider');

/** DI token for the active token market data provider. */
export const TOKEN_MARKET_PROVIDER = Symbol('TokenMarketProvider');

export interface PricePoint {
  /** Start of the bucket. */
  at: Date;
  /** USD per whole token at the close of the bucket. */
  priceUsd: number;
}

export interface HistoryWindow {
  /** Width of one bucket. Providers support a fixed set of widths. */
  bucketSeconds: number;
  /** How many buckets, ending now. */
  count: number;
}

export interface TokenPriceHistoryProvider {
  /** Closing prices, ascending by time. Empty when the mint has no market. */
  getHistory(mint: string, window: HistoryWindow): Promise<PricePoint[]>;
}

export interface TokenMarket {
  name: string | null;
  symbol: string | null;
  iconUrl: string | null;
  decimals: number | null;
  volume24hUsd: number | null;
}

export interface TokenMarketProvider {
  /** Null when the source does not know the mint. */
  getMarket(mint: string): Promise<TokenMarket | null>;
}
