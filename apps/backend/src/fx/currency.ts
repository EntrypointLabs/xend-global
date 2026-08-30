import { FxRateInvalidError } from './fx.errors';

/**
 * The currencies a Merchant may price in, and how many decimal places each
 * one's minor unit has.
 *
 * A Payment is displayed in the Merchant's own currency, so this grows as
 * markets do. The exponent is carried per currency rather than assumed to be
 * two: most currencies use two, the yen uses none and the dinar uses three, and
 * a converter that hardcodes hundredths is quietly wrong the day one of those
 * arrives.
 *
 * USD is the display currency for a Merchant pricing directly in the settlement
 * asset. The Consumer is shown dollars; USDC is a chain detail and never
 * appears on a surface anyone outside this repository reads.
 */
export const DISPLAY_CURRENCIES = {
  NGN: 2,
  USD: 2,
} as const satisfies Record<string, number>;

export type DisplayCurrency = keyof typeof DISPLAY_CURRENCIES;

export function isDisplayCurrency(value: string): value is DisplayCurrency {
  return value in DISPLAY_CURRENCIES;
}

/** The symbol a Consumer reads, falling back to the code for a new market. */
const SYMBOLS: Record<string, string> = { NGN: '₦', USD: '$' };

/**
 * An amount in a currency's minor unit, written the way a Consumer reads it.
 *
 * For anything a person sees. The ops console formats differently on purpose:
 * a table of Payments wants a currency code beside a plain number, and a
 * notification on a lock screen wants a symbol and thousands separators.
 */
export function formatDisplayMoney(
  currency: string,
  amountMinor: string,
): string {
  const decimals = minorUnitDecimals(currency);
  const scale = 10n ** BigInt(decimals);
  const minor = BigInt(amountMinor);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;

  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = abs % scale;
  const fractionPart =
    fraction > 0n ? '.' + fraction.toString().padStart(decimals, '0') : '';

  return `${negative ? '-' : ''}${SYMBOLS[currency] ?? currency + ' '}${whole}${fractionPart}`;
}

/** How many decimal places `currency`'s minor unit carries. */
export function minorUnitDecimals(currency: string): number {
  if (!isDisplayCurrency(currency)) {
    throw new FxRateInvalidError(`unsupported display currency ${currency}`);
  }
  return DISPLAY_CURRENCIES[currency];
}
