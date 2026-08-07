import { useMemo } from "react";

import { useBalances } from "@/hooks/useBalances";
import { getUsdcMint } from "@/utils/cluster";

export interface InvestmentHolding {
  mint: string;
  symbol: string | null;
  /** Human-readable amount, already scaled by the mint's decimals. */
  amount: number;
  decimals: number;
}

/**
 * Everything the Consumer holds that is not their spending balance.
 *
 * Investments are simply non-USDC token holdings. There is no separate account
 * and nothing to opt into: hold a token that is not USDC and it shows up here,
 * which is why this derives from the same balances the Cash screen reads rather
 * than fetching anything of its own.
 */
export function useInvestments() {
  const { tokens, isLoading, isError, refetch } = useBalances();

  const holdings = useMemo<InvestmentHolding[]>(() => {
    const usdcMint = getUsdcMint();
    return (
      tokens
        .filter((token) => token.mint !== usdcMint)
        // A closed token account lingers at zero, which is not a holding.
        .filter((token) => BigInt(token.amountRaw) > 0n)
        .map((token) => ({
          mint: token.mint,
          symbol: token.symbol,
          amount: Number(token.amountRaw) / 10 ** token.decimals,
          decimals: token.decimals,
        }))
        .sort((a, b) => b.amount - a.amount)
    );
  }, [tokens]);

  return {
    holdings,
    isEmpty: holdings.length === 0,
    isLoading,
    isError,
    refetch,
  };
}
