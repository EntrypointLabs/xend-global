import { FxRateInvalidError } from './fx.errors';

const USDC_DECIMALS = 6;

/** kobo (NGN minor, 2dp) -> USDC raw (u64, 6dp), half-up, BigInt only.
 *  usdcRaw = round( ngnMinor * 10^(rateDecimals+6) / (100 * rateScaled) )
 *
 *  This is the ONLY NGN<->USDC converter in the codebase. All money math is
 *  BigInt; no float ever touches a rate or amount. */
export function ngnMinorToUsdcRaw(
  ngnDisplayMinor: string,
  ngnPerUsdc: string,
  rateDecimals: number,
): string {
  if (!/^\d+$/.test(ngnDisplayMinor)) throw new FxRateInvalidError('ngn minor');
  const m = ngnPerUsdc.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new FxRateInvalidError('rate');
  const frac = m[2] ?? '';
  if (frac.length > rateDecimals)
    throw new FxRateInvalidError('rate precision');
  const rateScaled = BigInt(m[1] + frac.padEnd(rateDecimals, '0'));
  if (rateScaled <= 0n) throw new FxRateInvalidError('rate <= 0');
  const num =
    BigInt(ngnDisplayMinor) * 10n ** BigInt(rateDecimals + USDC_DECIMALS);
  const den = 100n * rateScaled;
  return ((num + den / 2n) / den).toString();
}
