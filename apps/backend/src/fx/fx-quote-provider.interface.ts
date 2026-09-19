/** DI token for the active checkout pricing provider. */
export const FX_QUOTE_PROVIDER = Symbol('FxQuoteProvider');

export interface FxQuote {
  /** NGN per 1 USDC. Determines the pinned debit, not later bank proceeds. */
  ngnPerUsdc: string;
  source: string;
  quotedAt: Date;
}

export interface FxQuoteProvider {
  /** Current NGN/USDC price, or throws FxQuoteUnavailableError. */
  getQuote(): Promise<FxQuote>;
}
