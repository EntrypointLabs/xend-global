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

/**
 * USDC minor units as dollars, cut to cents so it never shows more than moved.
 * Under a cent it keeps two significant digits instead, or a real movement
 * would read as $0.00.
 */
export function formatDollarsMinor(
  amountRaw: string,
  decimals: number
): string {
  const raw = BigInt(amountRaw);
  if (raw > 0n && decimals > 2 && raw < 10n ** BigInt(decimals - 2)) {
    const digits = raw.toString().padStart(decimals, "0");
    const first = digits.search(/[1-9]/);
    return `$0.${digits.slice(0, first + 2).replace(/0+$/, "")}`;
  }
  const cents =
    decimals >= 2
      ? raw / 10n ** BigInt(decimals - 2)
      : raw * 10n ** BigInt(2 - decimals);
  return `$${groupDigits(cents / 100n)}.${(cents % 100n)
    .toString()
    .padStart(2, "0")}`;
}

export type RampOutcome =
  | "completed"
  | "processing"
  | "refunding"
  | "refunded"
  | "failed";

/**
 * What a bank send's receipt should say happened.
 *
 * The transfer row only knows the USDC left the Account. The payout behind it
 * can still be processing, or be returned, so a confirmed send reports the
 * order's outcome. Null means the transfer's own status already says it: a
 * deposit, a send still on its way out, or an order status this app predates.
 */
export function rampOutcome(
  ramp: RampDetails,
  transferStatus: "pending" | "confirmed" | "failed"
): RampOutcome | null {
  if (ramp.direction !== "send" || transferStatus !== "confirmed") return null;
  switch (ramp.orderStatus) {
    case "completed":
      return "completed";
    case "creating":
    case "awaiting_payment":
    case "processing":
      return "processing";
    case "return_pending":
      return "refunding";
    case "returned":
      return "refunded";
    case "failed":
    case "expired":
    case "needs_attention":
      return "failed";
    default:
      return null;
  }
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
