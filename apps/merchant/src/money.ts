export function formatUsdc(raw: string | bigint, { suffix = false } = {}) {
  const value = BigInt(raw);
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % 1000000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${value < 0n ? "-" : ""}${absolute / 1000000n}.${fraction}${suffix ? " USDC" : ""}`;
}

/**
 * How each currency a Merchant may price in is written: its symbol and how many
 * decimals its minor unit carries. Most use two, the yen none and the dinar
 * three; a formatter that assumed hundredths would misstate those by a factor
 * of a hundred. Mirrors the Checkout surface's table so the two never drift.
 */
const CURRENCIES: Record<string, { symbol: string; decimals: number }> = {
  NGN: { symbol: "₦", decimals: 2 },
  USD: { symbol: "$", decimals: 2 },
  USDC: { symbol: "$", decimals: 6 },
};

/**
 * The Merchant-priced figure, from minor units. Integer-only BigInt math, so a
 * value beyond JavaScript's safe-integer ceiling stays exact rather than
 * collapsing to Infinity and printing the raw minor string. An unknown currency
 * falls back to its code and two decimals instead of throwing.
 */
export function formatDisplayAmount(currency: string, minor: string): string {
  const { symbol, decimals } = CURRENCIES[currency] ?? {
    symbol: `${currency} `,
    decimals: 2,
  };
  let value: bigint;
  try {
    value = BigInt(minor);
  } catch {
    return `${currency} ${minor}`;
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = abs % scale;
  const fractionPart =
    decimals > 0 ? "." + fraction.toString().padStart(decimals, "0") : "";
  return `${negative ? "-" : ""}${symbol}${whole}${fractionPart}`;
}
