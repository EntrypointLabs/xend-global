import { useSyncExternalStore } from "react";

import type { PendingSwap } from "@/utils/activity";

/**
 * How long a sent swap is shown before the chain reports it. Long past the
 * time a swap takes to land; after it, the row has either arrived from the
 * feed or the swap is not coming.
 */
const PENDING_SWAP_TTL_MS = 120_000;

let pending: PendingSwap[] = [];
const listeners = new Set<() => void>();

function publish(next: PendingSwap[]) {
  pending = next;
  listeners.forEach((listener) => listener());
}

export function addPendingSwap(swap: PendingSwap): void {
  publish([swap, ...pending.filter((s) => s.signature !== swap.signature)]);
  setTimeout(() => removePendingSwap(swap.signature), PENDING_SWAP_TTL_MS);
}

export function removePendingSwap(signature: string): void {
  if (!pending.some((swap) => swap.signature === signature)) return;
  publish(pending.filter((swap) => swap.signature !== signature));
}

/** Forgets every pending swap, for when the Account on this phone changes. */
export function clearPendingSwaps(): void {
  if (pending.length > 0) publish([]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Swaps this phone sent that Activity has not caught up with yet. */
export function usePendingSwaps(): PendingSwap[] {
  return useSyncExternalStore(subscribe, () => pending);
}
