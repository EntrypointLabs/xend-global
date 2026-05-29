import BigNumber from 'bignumber.js';

// Decimal precision per token symbol. USDC on Solana is 6 decimals.
// Mobile sends `amount` as a decimal string (e.g. "0.10"); we multiply by
// 10^decimals to get the base-unit string Grid's createPaymentIntent expects.
export const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
};

/**
 * Convert a human-decimal amount to a base-unit string for the given token.
 * Throws on an unknown token so we never silently drop the multiplier.
 *
 *   toBaseUnits("0.10", "USDC") -> "100000"
 *   toBaseUnits("1",    "USDC") -> "1000000"
 */
export function toBaseUnits(decimal: string, token: string): string {
  const dp = TOKEN_DECIMALS[token];
  if (dp === undefined) {
    throw new Error(`Unknown token: ${token}`);
  }
  return new BigNumber(decimal).shiftedBy(dp).toFixed(0);
}
