import { z } from "zod";

export const DisplayRatesSchema = z.object({
  /** Units of each currency that one US dollar buys. */
  perUsd: z.record(z.string(), z.number().positive()),
  quotedAt: z.string(),
});
export type DisplayRates = z.infer<typeof DisplayRatesSchema>;

/** Used when the app runs on seeded demo data, so the card always has a rate. */
export const DEMO_DISPLAY_RATES: DisplayRates = {
  perUsd: {
    USD: 1,
    GBP: 0.758,
    EUR: 0.91,
    NGN: 1530.25,
    THB: 33.89,
    GHS: 11.73,
    KES: 130.01,
    ZAR: 17.21,
    AED: 3.6725,
    JPY: 159.29,
  },
  quotedAt: "2026-11-18T00:00:00.000Z",
};

/** Currencies written without a fractional part. */
const WHOLE_UNIT_CURRENCIES = new Set([
  "JPY",
  "KRW",
  "VND",
  "CLP",
  "ISK",
  "PYG",
  "UGX",
  "RWF",
  "XAF",
  "XOF",
  "IDR",
]);

function amount(value: number, currency?: string | null): string {
  const digits = currency && WHOLE_UNIT_CURRENCIES.has(currency) ? 0 : 2;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** "£12.00", but "KES 12.00": a symbol that is letters needs a space. */
function money(symbol: string, value: string): string {
  return /\p{L}$/u.test(symbol) ? `${symbol} ${value}` : `${symbol}${value}`;
}

/**
 * The rate between the local currency and the dollar, written from whichever
 * side gives a number of at least one: "£1 = $1.32" where the local currency is
 * the stronger, "$1 = ₦1,530.25" where it is the weaker. Nobody reads
 * "₦1 = $0.00".
 */
export function formatRateLabel(
  localSymbol: string,
  perUsd: number,
  currency?: string | null
): string {
  return perUsd >= 1
    ? `$1 = ${money(localSymbol, amount(perUsd, currency))}`
    : `${money(localSymbol, "1")} = $${amount(1 / perUsd)}`;
}

/** A dollar amount shown in the local currency. */
export function formatLocalAmount(
  localSymbol: string,
  usd: number,
  perUsd: number,
  currency?: string | null
): string {
  return money(localSymbol, amount(usd * perUsd, currency));
}
