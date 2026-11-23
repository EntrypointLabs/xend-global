/** Native SOL is named by its wrapped mint, the way a balance read names it. */
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/** An asset on one side of a swap. */
export interface SwapToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl: string | null;
}

/** Seconds of headroom before `expiresAt`, so a price cannot lapse mid-confirmation. */
const EXPIRY_BUFFER_SECONDS = 8;

/**
 * A price for swapping one of the Account's assets for another, as the
 * backend quoted it. Amounts are integer strings at each mint's own decimals.
 */
export interface SwapQuote {
  quoteId: string;
  inputMint: string;
  outputMint: string;
  amountInRaw: string;
  outAmountRaw: string;
  /** The least the swap can settle at; below it, it fails and nothing moves. */
  minOutAmountRaw: string;
  slippageBps: number;
  /** Where the trade is routed, for display. */
  venue: string | null;
  /** Unix seconds. */
  expiresAt: number;
}

export function isSwapQuoteExpired(quote: SwapQuote, nowMs: number): boolean {
  return quote.expiresAt - EXPIRY_BUFFER_SECONDS <= Math.floor(nowMs / 1000);
}

/** Raw integer string to display units, without going through a float. */
export function formatRawAmount(raw: string, decimals: number): string {
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, "0");
  const whole = digits
    .slice(0, digits.length - decimals)
    .replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  // Grouped by string surgery. toLocaleString would route through a float and
  // silently round token amounts past 2^53.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}
