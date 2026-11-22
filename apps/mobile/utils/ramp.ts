import type { TransferRow } from "@/utils/apiClient";

export type RampDetails = NonNullable<TransferRow["ramp"]>;

function groupDigits(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "₦10,000" or "₦10,000.50": kobo only when there are any. */
export function formatNaira(amountMinor: string, decimals: number): string {
  const minor = BigInt(amountMinor);
  const scale = 10n ** BigInt(decimals);
  const fraction = (minor % scale).toString().padStart(decimals, "0");
  const whole = groupDigits(minor / scale);
  return /[1-9]/.test(fraction) ? `₦${whole}.${fraction}` : `₦${whole}`;
}

/** USDC minor units as dollars, cut to cents so it never shows more than moved. */
export function formatDollarsMinor(
  amountRaw: string,
  decimals: number
): string {
  const raw = BigInt(amountRaw);
  const cents =
    decimals >= 2
      ? raw / 10n ** BigInt(decimals - 2)
      : raw * 10n ** BigInt(2 - decimals);
  return `$${groupDigits(cents / 100n)}.${(cents % 100n)
    .toString()
    .padStart(2, "0")}`;
}

/** "1448.43" as "₦1,448.43". */
export function formatRate(rate: string): string {
  const [whole, fraction = ""] = rate.split(".");
  return `₦${groupDigits(BigInt(whole))}${fraction ? `.${fraction}` : ""}`;
}

const BANK_SUFFIX =
  /\s+(microfinance bank|mfb|bank|plc|limited|ltd|nigeria)\.?$/i;

/** "Kuda Microfinance Bank" as "Kuda", for a row with no room for the rest. */
export function shortBankName(name: string): string {
  let short = name.replace(/\(.*?\)/g, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = short.replace(BANK_SUFFIX, "").trim();
    if (!next || next === short) break;
    short = next;
  }
  return short || name;
}

/**
 * Who the row was with. A send names the person only: the bank's logo is
 * already on the row, and its full name is on the receipt.
 */
export function rampCounterparty(ramp: RampDetails): string {
  if (ramp.direction === "receive") return "Bank transfer";
  if (ramp.counterpartyName) return ramp.counterpartyName;
  return ramp.bankName ? shortBankName(ramp.bankName) : "Bank account";
}
