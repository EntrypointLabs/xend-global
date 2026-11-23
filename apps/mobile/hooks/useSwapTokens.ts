import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiClient } from "@/utils/apiClient";
import type { SwapToken } from "@/utils/swap";
import { describeToken } from "@/utils/tokens";

const DEBOUNCE_MS = 250;

/**
 * The verified assets Swap offers: the popular ones for an empty search, or
 * those matching it.
 */
export function useSwapTokens(search: string) {
  const [settled, setSettled] = useState(search.trim());

  useEffect(() => {
    const timer = setTimeout(() => setSettled(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ["swapTokens", settled.toLowerCase()],
    queryFn: async ({ signal }): Promise<SwapToken[]> => {
      const tokens = await apiClient.swapTokens(settled, signal);
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
    failed: query.isError && !query.data,
    retry: query.refetch,
  };
}
