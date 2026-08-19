import type { TokenBalance } from "@/utils/apiClient";
import { getUsdcMint } from "@/utils/cluster";

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
  const usdc = getUsdcMint();
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
  const usdcMint = getUsdcMint();
  if (!tokens) return 0;
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

export interface Portfolio {
  /** Spendable stablecoins, at face value. What the Cash screen holds. */
  cashUsd: number;
  /** Everything else the Consumer holds, at its priced value. */
  investmentsUsd: number;
  /**
   * A holding exists that nothing could price, so `investmentsUsd` is a floor
   * rather than the whole story. Distinguished from "holds nothing" because
   * the two look identical in the total and only one of them is true.
   */
  hasUnpricedHoldings: boolean;
}

/**
 * The Consumer's holdings split into the buckets the home screen shows.
 *
 * Stablecoins are counted at face value rather than at a quoted price: it is
 * the number they spend from, and $19.99 for 20 USDC is wrong in the only
 * place that has to be exact. Everything else is worth whatever it was priced
 * at, and an unpriced holding adds nothing rather than guessing.
 */
export function selectPortfolio(tokens: TokenBalance[] | undefined): Portfolio {
  const empty: Portfolio = {
    cashUsd: 0,
    investmentsUsd: 0,
    hasUnpricedHoldings: false,
  };
  if (!tokens) return empty;

  const stablecoins = stablecoinMints();
  return tokens.reduce<Portfolio>((acc, token) => {
    if (stablecoins.has(token.mint)) {
      acc.cashUsd += rawToNumber(token.amountRaw, token.decimals);
      return acc;
    }
    // A closed token account lingers at zero and is not a holding.
    if (BigInt(token.amountRaw) === 0n) return acc;

    if (token.usdValue == null) {
      acc.hasUnpricedHoldings = true;
      return acc;
    }
    acc.investmentsUsd += token.usdValue;
    return acc;
  }, empty);
}

/**
 * Money the way every amount in the app is written: "1,234.50".
 *
 * No currency symbol, because `BalanceView` renders the `$` itself along with
 * the split colouring that makes the decimals recede.
 */
export function formatMoney(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * USD per whole token, by mint, for everything currently held.
 *
 * The balance read is the only place prices arrive, so anything valuing a
 * historical movement has to take them from here. A mint that is no longer
 * held has no entry and cannot be valued.
 */
export function selectPricesByMint(
  tokens: TokenBalance[] | undefined
): Record<string, number> {
  const prices: Record<string, number> = {};
  if (!tokens) return prices;
  for (const token of tokens) {
    if (token.usdPrice != null) prices[token.mint] = token.usdPrice;
  }
  return prices;
}

/** Logos by mint, for anything rendering a token outside the balance list. */
export function selectIconsByMint(
  tokens: TokenBalance[] | undefined
): Record<string, string> {
  const icons: Record<string, string> = {};
  if (!tokens) return icons;
  for (const token of tokens) {
    if (token.iconUrl) icons[token.mint] = token.iconUrl;
  }
  return icons;
}

/**
 * A stored decimal string as money: "500.000000" reads "$500.00".
 *
 * Kept as a string end to end because it is a value the backend froze, and
 * routing it through a float on the way to the screen would be the one place
 * it could drift.
 */
export function formatUsdFromString(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return `$${formatMoney(parsed)}`;
}
