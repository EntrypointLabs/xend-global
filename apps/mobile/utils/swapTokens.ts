import type { TokenBalance } from "@/utils/apiClient";
import type { SwapToken } from "@/utils/swap";
import { describeToken } from "@/utils/tokens";

export interface HeldSwapToken extends SwapToken {
  amountRaw: string;
  /** USD per whole token, or null when nothing prices it. */
  usdPrice: number | null;
}

/**
 * The Account's holdings as assets that can be paid with, largest first by
 * value. A zero balance is left out: there is nothing of it to swap.
 */
export function heldSwapTokens(
  balances: readonly TokenBalance[]
): HeldSwapToken[] {
  return balances
    .filter((balance) => /^0*[1-9]/.test(balance.amountRaw))
    .slice()
    .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
    .map((balance) => {
      const { name, symbol } = describeToken(
        balance.mint,
        balance.symbol,
        balance.name
      );
      return {
        mint: balance.mint,
        // A mint nothing can name still has to be told apart from the others.
        symbol: symbol || name,
        name,
        decimals: balance.decimals,
        iconUrl: balance.iconUrl ?? null,
        amountRaw: balance.amountRaw,
        usdPrice: balance.usdPrice ?? null,
      };
    });
}

/** A mint address cut to its two ends, which is how one is told from another. */
export function shortTokenAddress(mint: string): string {
  return mint.length <= 9 ? mint : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

const MINT_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * A search as it is asked and remembered. Names and tickers are matched
 * without regard to case, so they are folded; an address is not, because two
 * addresses that differ only in case are different tokens.
 */
export function tokenSearchKey(search: string): string {
  const trimmed = search.trim();
  return MINT_ADDRESS.test(trimmed) ? trimmed : trimmed.toLowerCase();
}

/** Whether a token's name, ticker or mint address answers a search. */
export function matchesTokenSearch(token: SwapToken, search: string): boolean {
  const wanted = search.trim().toLowerCase();
  if (!wanted) return true;
  return (
    token.name.toLowerCase().includes(wanted) ||
    token.symbol.toLowerCase().includes(wanted) ||
    token.mint === search.trim()
  );
}
