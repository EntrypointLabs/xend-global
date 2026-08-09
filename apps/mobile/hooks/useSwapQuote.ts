import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchSwapQuote,
  isQuoteExpired,
  type SwapQuote,
} from "@/utils/swapQuote";

/** Long enough that a keypad tap does not fire a request per digit. */
const DEBOUNCE_MS = 350;

/**
 * Socket prices are short lived, so this refreshes on a timer rather than
 * waiting for the Consumer to notice a stale number.
 */
const REFETCH_MS = 20_000;

interface Params {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  userAddress: string | null;
  enabled: boolean;
}

export interface SwapQuoteState {
  quote: SwapQuote | null;
  isLoading: boolean;
  /** Present only when the Consumer asked for a quote that could not be made. */
  error: string | null;
}

export function useSwapQuote({
  inputMint,
  outputMint,
  amountRaw,
  userAddress,
  enabled,
}: Params): SwapQuoteState {
  const debouncedAmount = useDebounced(amountRaw, DEBOUNCE_MS);
  const active =
    enabled &&
    !!userAddress &&
    debouncedAmount !== "0" &&
    debouncedAmount !== "";

  const query = useQuery({
    queryKey: [
      "swapQuote",
      inputMint,
      outputMint,
      debouncedAmount,
      userAddress,
    ],
    enabled: active,
    queryFn: ({ signal }) =>
      fetchSwapQuote({
        inputMint,
        outputMint,
        amountRaw: debouncedAmount,
        userAddress: userAddress!,
        signal,
      }),
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
  const stale = quote ? isQuoteExpired(quote, now) : false;

  return {
    quote: stale ? null : quote,
    isLoading: active && (query.isFetching || stale),
    error: active && query.error ? describe(query.error) : null,
  };
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message || "Couldn't price this swap";
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
