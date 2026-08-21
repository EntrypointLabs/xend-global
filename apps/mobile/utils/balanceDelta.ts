import type { BalancePoint } from "@/components/ui/organisms/BalanceChart";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Smallest baseline that can carry a percentage: one cent. */
const MIN_BASELINE = 0.01;

export interface BalanceDelta {
  /** Signed fraction: 0.0002 is +0.02%. */
  fraction: number;
  display: string;
}

/**
 * Change over the last 24 hours, or null when there is nothing to compare
 * against.
 *
 * Returning null is the common case for a new wallet, and it has to be: a
 * percentage needs a positive baseline. "-100%" against a wallet that was
 * always empty reads as a loss the Consumer never took, and a rise from zero
 * has no percentage at all.
 */
export function selectBalanceDelta(
  history: BalancePoint[],
  now: number
): BalanceDelta | null {
  if (history.length < 2) return null;

  // Never held anything, so there is no loss to report on the way back to zero.
  if (!history.some((point) => point.value > 0)) return null;

  const cutoff = now - DAY_MS;
  const prior =
    [...history].reverse().find((point) => point.at <= cutoff) ?? history[0]!;

  // A baseline below a cent gives no percentage worth showing. Zero or less
  // means the replayed transfers are incomplete rather than that the Consumer
  // owed money; a fraction of a cent is float residue left by the walk-back
  // subtracting a value from itself. Dividing by that residue is what put
  // "+1120591080155801216.00%" on the home screen.
  if (prior.value < MIN_BASELINE) return null;

  const current = history[history.length - 1]!.value;
  const fraction = (current - prior.value) / prior.value;
  const percent = Math.abs(fraction * 100);

  return {
    fraction,
    display: `${fraction > 0 ? "+" : fraction < 0 ? "-" : ""}${percent.toFixed(2)}%`,
  };
}
