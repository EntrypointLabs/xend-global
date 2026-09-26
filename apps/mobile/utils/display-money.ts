import { formatMoney } from "@/utils/money";

export type DisplayCurrency = "NGN" | "USD" | "USDC";

/**
 * One display rule for every fiat screen: fiat gets its symbol ("₦385,420.50",
 * "$3,104.45"); USDC is written with its code and two places ("2,847.50
 * USDC"), because six on-chain decimals are noise to a person reading a
 * balance. Truncates rather than rounds so a figure never overstates funds.
 */
export function displayMoney(
  currency: DisplayCurrency,
  amountMinor: string,
  decimals = currency === "USDC" ? 6 : 2
): string {
  if (currency !== "USDC") {
    return formatMoney(currency, rescale(amountMinor, decimals, 2));
  }
  const cents = BigInt(rescale(amountMinor, decimals, 2));
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${(cents % 100n).toString().padStart(2, "0")} USDC`;
}

function rescale(minor: string, from: number, to: number): string {
  const v = BigInt(minor);
  if (from === to) return v.toString();
  return from > to
    ? (v / 10n ** BigInt(from - to)).toString()
    : (v * 10n ** BigInt(to - from)).toString();
}
