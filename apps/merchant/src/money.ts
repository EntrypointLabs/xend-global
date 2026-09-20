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
 * The Merchant-priced figure, from minor units. Most currencies use two
 * minor digits; Intl formats the code when it is a real ISO currency and
 * falls back to a plain "CODE amount" for anything it does not recognise.
 */
export function formatDisplayAmount(currency: string, minor: string): string {
  const amount = Number(minor) / 100;
  if (!Number.isFinite(amount)) return `${currency} ${minor}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
