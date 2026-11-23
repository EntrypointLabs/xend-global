import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiClient } from "@/utils/apiClient";
import type { SwapTokenCategory, SwapTokenListing } from "@/utils/swap";
import { describeToken } from "@/utils/tokens";

const DEBOUNCE_MS = 250;

/**
 * The verified assets Swap offers: those matching a search, or else the
 * popular ones on one shelf, or else the everyday list.
 */
export function useSwapTokens(
  search: string,
  category: SwapTokenCategory | null
) {
  const [settled, setSettled] = useState(search.trim());

  useEffect(() => {
    const timer = setTimeout(() => setSettled(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // A search looks everywhere, so the shelf does not change its answer.
  const shelf = settled ? null : category;
  const query = useQuery({
    queryKey: ["swapTokens", settled.toLowerCase(), shelf ?? "everyday"],
    queryFn: async ({ signal }): Promise<SwapTokenListing[]> => {
      const tokens = await apiClient.swapTokens(settled, shelf, signal);
      // The index's "Wrapped SOL" is Solana everywhere else in the app.
      return tokens.map((token) => ({
        ...token,
        ...describeToken(token.mint, token.symbol, token.name),
      }));
    },
    staleTime: 60_000,
    // The last list stays up while the next one loads, so the rows do not
    // blink out between keystrokes.
    placeholderData: keepPreviousData,
  });

  return {
    tokens: query.data ?? [],
    isLoading: query.isPending,
    // Rows on screen that belong to the previous shelf or search.
    isStale: query.isPlaceholderData,
    failed: query.isError && !query.data,
    retry: query.refetch,
  };
}
