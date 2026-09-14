/** Decimal conversion without binary floating-point arithmetic. */
export function decimalToMinor(value: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Invalid decimal amount');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new Error('Amount exceeds currency precision');
  }
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0')
  ).toString();
}
export function minorToDecimal(value: string, decimals: number): string {
  if (!/^\d+$/.test(value)) throw new Error('Invalid minor amount');
  const padded = value.padStart(decimals + 1, '0');
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}
