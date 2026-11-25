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

export const SWAP_TOKEN_CATEGORIES = ["crypto", "stocks", "meme"] as const;
export type SwapTokenCategory = (typeof SWAP_TOKEN_CATEGORIES)[number];

/**
 * How far a token's identity can be relied on. `caution` is an unverified
 * token wearing a verified one's ticker.
 */
export type SwapTokenTrust = "verified" | "unverified" | "caution";

/** An asset as the picker lists it. */
export interface SwapTokenListing extends SwapToken {
  category: SwapTokenCategory;
  trust: SwapTokenTrust;
  /** USD per whole token, or null when nothing prices it. */
  usdPrice: number | null;
}

/**
 * A token's price as a Consumer reads it. A price under a dollar keeps four
 * significant figures, because two decimals would show most tokens as $0.00.
 */
export function formatTokenPrice(usdPrice: number): string {
  if (usdPrice >= 1) {
    return `$${usdPrice.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `$${Number(usdPrice.toPrecision(4)).toLocaleString("en-US", {
    maximumFractionDigits: 10,
  })}`;
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
  /** Every venue the route passes through, in order. */
  venues: string[];
  /** Unix seconds. */
  expiresAt: number;
}

export function isSwapQuoteExpired(quote: SwapQuote, nowMs: number): boolean {
  return quote.expiresAt - EXPIRY_BUFFER_SECONDS <= Math.floor(nowMs / 1000);
}

/**
 * A typed amount as the integer the chain counts in. Done on the digits, not
 * through a float: a nine-decimal balance does not survive being multiplied
 * as a number, and "all of it" has to mean exactly all of it. Digits past the
 * token's precision are dropped, since no such fraction of it exists.
 */
export function toRawAmount(amount: string, decimals: number): string {
  const [whole = "", fraction = ""] = amount.split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return "0";
  const digits = whole + fraction.slice(0, decimals).padEnd(decimals, "0");
  return digits.replace(/^0+(?=\d)/, "") || "0";
}

/**
 * A raw amount cut to a few decimal places for a label. Cut, never rounded:
 * a balance of 3.99999 shown as 4 would promise more than is held.
 */
export function formatRawAmountShort(
  raw: string,
  decimals: number,
  places = 4
): string {
  const [whole, fraction = ""] = formatRawAmount(raw, decimals).split(".");
  const kept = fraction.slice(0, places).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : whole;
}

/** A raw amount as it would be typed on the keypad: no grouping commas. */
export function toAmountInput(raw: string, decimals: number): string {
  return formatRawAmount(raw, decimals).replace(/,/g, "");
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
