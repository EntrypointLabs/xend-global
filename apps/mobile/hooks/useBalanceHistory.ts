import { useMemo, useState } from "react";

import type { BalancePoint } from "@/components/ui/organisms/BalanceChart";
import { useBalances } from "@/hooks/useBalances";
import { useTransfersInfinite } from "@/hooks/useTransfers";
import { selectBalanceDelta } from "@/utils/balanceDelta";
import { selectBalanceHistory } from "@/utils/balanceHistory";
import type { BalanceDelta } from "@/utils/balanceDelta";

/**
 * Portfolio value over time for the chart. The walk itself is
 * `selectBalanceHistory`; this supplies it with what the Consumer holds now.
 *
 * @param currentTotal today's portfolio value, passed in rather than
 *   recomputed so the chart's right-hand end is the same number as the
 *   headline above it, Earn included.
 */
export function useBalanceHistory(currentTotal: number): BalancePoint[] {
  const { decimalsByMint, pricesByMint } = useBalances();
  // Stable per mount: Date.now() inside the memo is an impure render.
  const [now] = useState(() => Date.now());
  const { data } = useTransfersInfinite();

  return useMemo(() => {
    const rows = data?.pages.flatMap((page) => page.transfers) ?? [];
    return selectBalanceHistory(rows, {
      currentTotal,
      pricesByMint,
      decimalsByMint,
      now,
    });
  }, [data, currentTotal, decimalsByMint, pricesByMint, now]);
}

export function useBalanceDelta(history: BalancePoint[]): BalanceDelta | null {
  const [now] = useState(() => Date.now());
  return useMemo(() => selectBalanceDelta(history, now), [history, now]);
}
