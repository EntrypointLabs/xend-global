import { z } from "zod";

export const DisplayRatesSchema = z.object({
  /** Units of each currency that one US dollar buys. */
  perUsd: z.record(z.string(), z.number().positive()),
  quotedAt: z.string(),
});
export type DisplayRates = z.infer<typeof DisplayRatesSchema>;

/** Used when the app runs on seeded demo data, so the card always has a rate. */
export const DEMO_DISPLAY_RATES: DisplayRates = {
  perUsd: { USD: 1, GBP: 0.758, EUR: 0.91, NGN: 1530.25 },
  quotedAt: "2026-11-18T00:00:00.000Z",
};

function amount(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * The rate between the local currency and the dollar, written from whichever
 * side gives a number of at least one: "£1 = $1.32" where the local currency is
 * the stronger, "$1 = ₦1,530.25" where it is the weaker. Nobody reads
 * "₦1 = $0.00".
 */
export function formatRateLabel(localSymbol: string, perUsd: number): string {
  return perUsd >= 1
    ? `$1 = ${localSymbol}${amount(perUsd)}`
    : `${localSymbol}1 = $${amount(1 / perUsd)}`;
}

/** A dollar amount shown in the local currency. */
export function formatLocalAmount(
  localSymbol: string,
  usd: number,
  perUsd: number
): string {
  return `${localSymbol}${amount(usd * perUsd)}`;
}
