import type { TokenBalance } from "@/utils/apiClient";

/**
 * Pure balance selectors. No React/React Native imports so the BigInt-safe
 * money math is unit-testable under plain jest; `hooks/useBalances.ts`
 * re-exports these for screen consumers.
 */

/**
 * Stablecoin mints that count toward the headline Balance. USDT is optional in
 * dev (no canonical devnet mint); when unset, only USDC contributes. Read from
 * the environment on every call so tests can vary it.
 */
function stablecoinMints(): Set<string> {
  const mints = new Set<string>();
  const usdc = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;
  const usdt = process.env.EXPO_PUBLIC_USDT_MINT_ADDRESS;
  if (usdc) mints.add(usdc);
  if (usdt) mints.add(usdt);
  return mints;
}

// Convert a u64 raw amount to a display number without precision loss on the
// integer part. BigInt handles the whole units; the sub-unit remainder is the
// only place floating point enters.
function rawToNumber(amountRaw: string, decimals: number): number {
  const raw = BigInt(amountRaw);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = Number(raw / divisor);
  const fraction = Number(raw % divisor) / Number(divisor);
  return whole + fraction;
}

function roundTo2(value: number): number {
  return parseFloat(value.toFixed(2));
}

/**
 * Headline Balance: the sum of recognized stablecoin balances (USDC + USDT),
 * rounded to 2 decimals. Defaults to 0 for an absent/empty token list.
 */
export function selectStablecoinTotal(
  tokens: TokenBalance[] | undefined
): number {
  if (!tokens) return 0;
  const mints = stablecoinMints();
  let total = 0;
  for (const t of tokens) {
    if (!mints.has(t.mint)) continue;
    total += rawToNumber(t.amountRaw, t.decimals);
  }
  return roundTo2(total);
}

/** The USDC holding as a display number (0 when absent or USDC mint unset). */
export function selectUsdc(tokens: TokenBalance[] | undefined): number {
  const usdcMint = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;
  if (!tokens || !usdcMint) return 0;
  const token = tokens.find((t) => t.mint === usdcMint);
  return token ? roundTo2(rawToNumber(token.amountRaw, token.decimals)) : 0;
}

/** Lookup of per-mint decimals, for mapping transfer rows that omit them. */
export function selectDecimalsByMint(
  tokens: TokenBalance[] | undefined
): Record<string, number> {
  const map: Record<string, number> = {};
  if (!tokens) return map;
  for (const t of tokens) map[t.mint] = t.decimals;
  return map;
}
