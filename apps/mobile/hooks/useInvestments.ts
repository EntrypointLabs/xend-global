import { useMemo } from "react";

import { useBalances } from "@/hooks/useBalances";
import { getUsdcMint } from "@/utils/cluster";
import { describeToken } from "@/utils/tokens";

export interface InvestmentHolding {
  mint: string;
  /** What a Consumer calls it: "Solana". */
  name: string;
  symbol: string;
  /** Human-readable amount, already scaled by the mint's decimals. */
  amount: number;
  decimals: number;
  /** What the holding is worth, or null when nothing could price the mint. */
  usdValue: number | null;
  /** Percent change over 24h, or null when nothing reports one. */
  priceChange24h: number | null;
  /** The token's logo, when the index knows one. */
  iconUrl: string | null;
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
        .map((token) => {
          const { name, symbol } = describeToken(
            token.mint,
            token.symbol,
            token.name
          );
          return {
            mint: token.mint,
            name,
            symbol,
            amount: Number(token.amountRaw) / 10 ** token.decimals,
            decimals: token.decimals,
            usdValue: token.usdValue ?? null,
            priceChange24h: token.priceChange24h ?? null,
            iconUrl: token.iconUrl ?? null,
          };
        })
        // Ordered by what they are worth, not by how many units there are: a
        // million of something worthless is not the Consumer's top holding.
        .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
    );
  }, [tokens]);

  // What the Investments screen shows as its Balance: the same number the home
  // tile shows, so the two cannot disagree.
  const totalUsd = holdings.reduce((sum, h) => sum + (h.usdValue ?? 0), 0);

  return {
    holdings,
    totalUsd,
    isEmpty: holdings.length === 0,
    isLoading,
    isError,
    refetch,
  };
}
