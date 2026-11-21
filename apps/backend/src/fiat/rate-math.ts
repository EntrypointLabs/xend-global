/**
 * Integer money arithmetic for provider rates. A rate is units of the fiat
 * currency per one whole USDC, as a decimal string. Nothing here passes money
 * through a binary float.
 */
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export function parseDecimal(value: string): { digits: bigint; scale: number } {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new Error(`not a non-negative decimal: ${value}`);
  const fraction = match[2] ?? '';
  return { digits: BigInt(match[1] + fraction), scale: fraction.length };
}

/** A provider's JSON number as a plain decimal string, without exponent form. */
export function numberToDecimal(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('not a finite non-negative number');
  }
  const text = value.toString();
  return text.includes('e') ? value.toFixed(20).replace(/\.?0+$/, '') : text;
}

/** Decimal amount to minor units, dropping digits beyond the precision. */
export function decimalToMinorFloor(value: string, decimals: number): bigint {
  const { digits, scale } = parseDecimal(value);
  return scale <= decimals
    ? digits * 10n ** BigInt(decimals - scale)
    : digits / 10n ** BigInt(scale - decimals);
}

export function minorToDecimalString(units: bigint, decimals: number): string {
  const text = units.toString().padStart(decimals + 1, '0');
  const whole = text.slice(0, text.length - decimals);
  const fraction = text.slice(text.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** USDC minor units to fiat minor units at `rate`, rounded down. */
export function usdcToFiat(
  usdcMinor: bigint,
  rate: string,
  fiatDecimals: number,
): bigint {
  const { digits, scale } = parseDecimal(rate);
  return (
    (usdcMinor * digits * 10n ** BigInt(fiatDecimals)) /
    10n ** BigInt(6 + scale)
  );
}

/** Fiat minor units to USDC minor units at `rate`, rounded down. */
export function fiatToUsdc(
  fiatMinor: bigint,
  rate: string,
  fiatDecimals: number,
): bigint {
  const { digits, scale } = parseDecimal(rate);
  if (digits === 0n) throw new Error('rate is zero');
  return (
    (fiatMinor * 10n ** BigInt(6 + scale)) /
    (digits * 10n ** BigInt(fiatDecimals))
  );
}

/** The least USDC that converts to at least `fiatMinor` at `rate`. */
export function usdcForFiat(
  fiatMinor: bigint,
  rate: string,
  fiatDecimals: number,
): bigint {
  const { digits, scale } = parseDecimal(rate);
  if (digits === 0n) throw new Error('rate is zero');
  const numerator = fiatMinor * 10n ** BigInt(6 + scale);
  const denominator = digits * 10n ** BigInt(fiatDecimals);
  return (numerator + denominator - 1n) / denominator;
}
