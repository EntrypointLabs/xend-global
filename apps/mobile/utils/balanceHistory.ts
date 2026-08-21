import type { BalancePoint } from "@/components/ui/organisms/BalanceChart";
import type { TransferRow } from "@/utils/apiClient";

export interface HistoryInputs {
  /** Today's portfolio value: the anchor the walk starts from. */
  currentTotal: number;
  /** USD per whole token, by mint. A mint absent here cannot be valued. */
  pricesByMint: Record<string, number>;
  decimalsByMint: Record<string, number>;
  now: number;
}

/** Decimals for a mint the balance read never returned. USDC's, the common case. */
const FALLBACK_DECIMALS = 6;

/**
 * Portfolio value over time, reconstructed by walking confirmed transfers
 * backwards from what the Consumer holds now.
 *
 * Derived rather than fetched: the backend stores transfers, not balance
 * snapshots. History reaches only as far back as the rows it is given.
 *
 * Every mint is valued at TODAY's price, so the line tracks money moving in
 * and out rather than the market moving underneath it: a holding that doubled
 * while untouched draws flat. Mark-to-market would need a price per mint per
 * point in time, which no read here has.
 */
export function selectBalanceHistory(
  rows: TransferRow[],
  { currentTotal, pricesByMint, decimalsByMint, now }: HistoryInputs
): BalancePoint[] {
  if (rows.length === 0) return [];

  const confirmed = rows
    .filter((row) => row.status === "CONFIRMED")
    .map((row) => {
      const price = pricesByMint[row.mint];
      // An unpriceable mint cannot be undone in dollars. Leaving its step out
      // of the line beats inventing a cliff the Consumer never experienced.
      if (price == null) return null;
      const decimals = decimalsByMint[row.mint] ?? FALLBACK_DECIMALS;
      const amount = Number(row.amountRaw) / 10 ** decimals;
      return {
        at: Date.parse(row.confirmedAt ?? row.createdAt),
        // Signed by direction so the walk-back can undo it.
        delta: amount * price * (row.direction === "SEND" ? -1 : 1),
      };
    })
    .filter((row): row is { at: number; delta: number } => row !== null)
    .filter((row) => Number.isFinite(row.at))
    .sort((a, b) => b.at - a.at);

  if (confirmed.length === 0) return [];

  // Walk backwards from today's value, undoing each transfer to recover the
  // value immediately before it.
  const points: BalancePoint[] = [{ at: now, value: currentTotal }];
  let running = currentTotal;
  for (const row of confirmed) {
    points.push({ at: row.at, value: running });
    // Clamped because a balance cannot go negative. Undoing the loaded
    // transfers can drive it below zero when the set is incomplete: an outflow
    // with no confirmed transfer row to replay (a swap, an Earn deposit, a
    // card spend) leaves its inflow unmatched.
    running = Math.max(0, running - row.delta);
  }
  points.push({ at: confirmed[confirmed.length - 1]!.at - 1, value: running });

  return points.reverse();
}
