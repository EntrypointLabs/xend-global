import { useMemo, useState } from "react";

import type { BalancePoint } from "@/components/ui/organisms/BalanceChart";
import { useBalances } from "@/hooks/useBalances";
import { useTransfersInfinite } from "@/hooks/useTransfers";
import { getUsdcMint } from "@/utils/cluster";
import { selectBalanceDelta } from "@/utils/balanceDelta";
import type { BalanceDelta } from "@/utils/balanceDelta";

/**
 * Balance over time, reconstructed by walking confirmed transfers backwards
 * from the current balance.
 *
 * Derived rather than fetched: the backend stores transfers, not balance
 * snapshots, and replaying them is exact for the only thing the chart shows.
 * It means history only reaches as far back as the loaded pages, which is fine
 * because the chart windows by range anyway.
 */
export function useBalanceHistory(): BalancePoint[] {
  const { usdc } = useBalances();
  // Stable per mount: Date.now() inside the memo is an impure render.
  const [now] = useState(() => Date.now());
  const { data } = useTransfersInfinite();

  return useMemo(() => {
    const rows = data?.pages.flatMap((page) => page.transfers) ?? [];
    if (rows.length === 0) return [];

    const usdcMint = getUsdcMint();
    const confirmed = rows
      .filter((r) => r.status === "CONFIRMED" && r.mint === usdcMint)
      .map((r) => ({
        at: Date.parse(r.confirmedAt ?? r.createdAt),
        // Six decimals: USDC. Signed by direction so the walk-back can undo it.
        delta: (Number(r.amountRaw) / 1e6) * (r.direction === "SEND" ? -1 : 1),
      }))
      .filter((r) => Number.isFinite(r.at))
      .sort((a, b) => b.at - a.at);

    if (confirmed.length === 0) return [];

    // Walk backwards from today's balance, undoing each transfer to recover the
    // balance immediately before it.
    const points: BalancePoint[] = [{ at: now, value: usdc }];
    let running = usdc;
    for (const row of confirmed) {
      points.push({ at: row.at, value: running });
      // Clamped because a balance cannot go negative. Undoing the loaded
      // transfers can drive it below zero when the set is incomplete: outflows
      // with no confirmed USDC transfer row to replay (swaps, Earn deposits,
      // card spends) leave their inflow unmatched.
      running = Math.max(0, running - row.delta);
    }
    points.push({
      at: confirmed[confirmed.length - 1]!.at - 1,
      value: running,
    });

    return points.reverse();
  }, [data, usdc, now]);
}

export function useBalanceDelta(history: BalancePoint[]): BalanceDelta | null {
  const [now] = useState(() => Date.now());
  return useMemo(() => selectBalanceDelta(history, now), [history, now]);
}
