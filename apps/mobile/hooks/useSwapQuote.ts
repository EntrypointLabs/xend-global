import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/utils/apiClient";
import { isSwapQuoteExpired, type SwapQuote } from "@/utils/swap";

/** Long enough that a keypad tap does not fire a request per digit. */
const DEBOUNCE_MS = 350;

/**
 * Prices are offered for half a minute, so this refreshes well inside that
 * rather than waiting for the Consumer to notice a stale number.
 */
const REFETCH_MS = 12_000;

interface Params {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  enabled: boolean;
}

export interface SwapQuoteState {
  quote: SwapQuote | null;
  isLoading: boolean;
  /** Present only when the Consumer asked for a quote that could not be made. */
  error: string | null;
}

/** A live price for swapping one of the Account's assets for another. */
export function useSwapQuote({
  inputMint,
  outputMint,
  amountRaw,
  enabled,
}: Params): SwapQuoteState {
  const debouncedAmount = useDebounced(amountRaw, DEBOUNCE_MS);
  const active = enabled && debouncedAmount !== "0" && debouncedAmount !== "";

  const query = useQuery({
    queryKey: ["swapQuote", inputMint, outputMint, debouncedAmount],
    enabled: active,
    queryFn: async ({ signal }): Promise<SwapQuote> => {
      const quoted = await apiClient.swapQuote(
        { inputMint, outputMint, amountRaw: debouncedAmount },
        signal
      );
      return {
        quoteId: quoted.quoteId,
        inputMint: quoted.inputMint,
        outputMint: quoted.outputMint,
        amountInRaw: quoted.amountInRaw,
        outAmountRaw: quoted.amountOutRaw,
        minOutAmountRaw: quoted.minAmountOutRaw,
        slippageBps: quoted.slippageBps,
        venue: quoted.venue,
        expiresAt: quoted.expiresAt,
      };
    },
    refetchInterval: REFETCH_MS,
    // A price is worth nothing once it is old; showing the previous pair's
    // number while a new one loads would misprice the trade on screen.
    gcTime: 0,
    retry: 1,
  });

  const quote = query.data ?? null;
  // Ticked from an effect rather than read during render: calling Date.now()
  // while rendering makes the result depend on when React happens to re-run.
  const now = useTicker(!!quote);
  const stale = quote ? isSwapQuoteExpired(quote, now) : false;

  return {
    quote: stale ? null : quote,
    // A refresh behind a price still on screen is not loading: saying so
    // would blank a good number every few seconds.
    isLoading: active && (stale || (query.isFetching && !quote)),
    error: active && query.error ? describeQuoteError(query.error) : null,
  };
}

const QUOTE_ERRORS: Record<string, string> = {
  NO_ROUTE: "No route for this swap right now",
  SWAP_UNAVAILABLE: "Swap is unavailable right now",
  ACCOUNT_NOT_READY: "Your Account is not ready yet",
};

function describeQuoteError(error: unknown): string {
  const code = (error as { data?: { code?: string } })?.data?.code;
  return (code && QUOTE_ERRORS[code]) || "Couldn't price this swap";
}

/** Wall clock that advances only while something is counting down against it. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return now;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
