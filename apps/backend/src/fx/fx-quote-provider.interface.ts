/** DI token for the active executable-quote provider. */
export const FX_QUOTE_PROVIDER = Symbol('FxQuoteProvider');

export interface FxQuote {
  /** NGN per 1 USDC, decimal string. The checkout-charge quote:
   *  it drives the USDC the Consumer is charged. The actual naira
   *  conversion and realized spread happen at settlement and are the
   *  settlement provider's. At pilot the spread is the config
   *  fx_spread_bps only; realized naira detail arrives later via
   *  SettlementCompletion optionals, not via report(). */
  ngnPerUsdc: string;
  source: string;
  quotedAt: Date;
}

export interface FxQuoteProvider {
  /** Current executable NGN/USDC quote, or throws FxQuoteUnavailableError. */
  getQuote(): Promise<FxQuote>;
}
