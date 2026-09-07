/**
 * How each currency a Merchant may price in is written: its symbol and how many
 * decimal places its minor unit carries.
 *
 * A Payment shows the Merchant's own currency, so this grows with the markets
 * Xend opens in. The decimals are carried rather than assumed to be two,
 * because most currencies use two, the yen uses none and the dinar uses three,
 * and a formatter that hardcodes hundredths misstates an amount by a factor of
 * a hundred the day one of those arrives.
 */
const CURRENCIES: Record<string, { symbol: string; decimals: number }> = {
  NGN: { symbol: '₦', decimals: 2 },
  USD: { symbol: '$', decimals: 2 },
};

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format an amount given in a currency's minor units. Integer-only math via
 * BigInt so values beyond the safe-integer ceiling stay exact; the fractional
 * part is shown only when non-zero. No float coercion of the amount is ever
 * performed.
 *
 * An unknown currency falls back to its code and two decimals rather than
 * throwing. A shopper looking at a confirm sheet is better served by a readable
 * figure with an unfamiliar prefix than by a popup that fails to render, and
 * the amount itself stays correct for every two-decimal currency.
 */
export function formatMoney(currency: string, minorRaw: string): string {
  const { symbol, decimals } = CURRENCIES[currency] ?? {
    symbol: `${currency} `,
    decimals: 2,
  };
  const minor = BigInt(minorRaw);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;

  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = abs % scale;

  const grouped = groupThousands(whole.toString());
  const fractionPart =
    fraction > 0n ? '.' + fraction.toString().padStart(decimals, '0') : '';

  return `${negative ? '-' : ''}${symbol}${grouped}${fractionPart}`;
}
