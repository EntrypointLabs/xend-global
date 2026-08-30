import { minorUnitDecimals } from './currency';
import { FxRateInvalidError } from './fx.errors';

const USDC_DECIMALS = 6;

/** A local currency's minor unit -> USDC raw (u64, 6dp), half-up, BigInt only.
 *  usdcRaw = round( minor * 10^(rateDecimals+6) / (10^minorDecimals * rateScaled) )
 *
 *  This is the ONLY local-currency<->USDC converter in the codebase. All money
 *  math is BigInt; no float ever touches a rate or amount. The minor unit is
 *  taken from the currency rather than assumed, so a Merchant pricing in
 *  something other than naira converts correctly rather than by a factor of a
 *  hundred. */
export function localMinorToUsdcRaw(
  displayAmountMinor: string,
  unitsPerUsdc: string,
  rateDecimals: number,
  currency: string,
): string {
  if (!/^\d+$/.test(displayAmountMinor))
    throw new FxRateInvalidError('display minor');
  const m = unitsPerUsdc.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new FxRateInvalidError('rate');
  const frac = m[2] ?? '';
  if (frac.length > rateDecimals)
    throw new FxRateInvalidError('rate precision');
  const rateScaled = BigInt(m[1] + frac.padEnd(rateDecimals, '0'));
  if (rateScaled <= 0n) throw new FxRateInvalidError('rate <= 0');
  const num =
    BigInt(displayAmountMinor) * 10n ** BigInt(rateDecimals + USDC_DECIMALS);
  const den = 10n ** BigInt(minorUnitDecimals(currency)) * rateScaled;
  return ((num + den / 2n) / den).toString();
}

/** USDC raw (6dp) -> a dollar figure in cents, for a Merchant pricing in USD. */
export function usdcRawToUsdMinor(usdcSettlementRaw: string): string {
  if (!/^\d+$/.test(usdcSettlementRaw))
    throw new FxRateInvalidError('usdc raw');
  const scale = 10n ** BigInt(USDC_DECIMALS - minorUnitDecimals('USD'));
  const raw = BigInt(usdcSettlementRaw);
  return ((raw + scale / 2n) / scale).toString();
}
