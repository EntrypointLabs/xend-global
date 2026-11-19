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

/**
 * Minor-unit digits for currencies that do not use two (ISO 4217). IDR keeps
 * two in the standard but is never written with them in practice.
 */
const FRACTION_DIGITS: Record<string, number> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  IDR: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

function amount(value: number, currency?: string | null): string {
  const digits = currency ? (FRACTION_DIGITS[currency] ?? 2) : 2;
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

/** An amount in a currency's own minor units, without a symbol: "1,530.25". */
export function formatCurrencyAmount(value: number, currency: string): string {
  return amount(value, currency);
}

/**
 * The same rate as `formatRateLabel`, written with codes for screens that show
 * the currency beside it: "1 GBP = 1.32 USD", "1 USD = 1,530.25 NGN".
 */
export function formatCodeRate(currency: string, perUsd: number): string {
  return perUsd >= 1
    ? `1 USD = ${amount(perUsd, currency)} ${currency}`
    : `1 ${currency} = ${amount(1 / perUsd)} USD`;
}

/**
 * A round price that means something in the currency: 1 where a unit is worth
 * about a dollar or more, otherwise the next power of ten above a dollar's
 * worth, so naira opens on 10,000 rather than a price that converts to $0.00.
 */
export function startingPrice(perUsd: number): string {
  const value = perUsd < 10 ? 1 : 10 ** Math.ceil(Math.log10(perUsd));
  return value.toLocaleString("en-US");
}
