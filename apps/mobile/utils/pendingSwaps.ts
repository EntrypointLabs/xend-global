import { useSyncExternalStore } from "react";

import type { PendingSwap } from "@/utils/activity";

/**
 * How long a sent swap is shown before this phone hears how it ended. Long
 * past the time a swap takes to land; after it, the swap is not coming.
 */
const PENDING_SWAP_TTL_MS = 120_000;
/**
 * How long a swap this phone saw settle stays, waiting for Activity to fetch
 * its own row. Activity replaces it the moment it has that row.
 */
const SETTLED_SWAP_TTL_MS = 10 * 60_000;

let pending: PendingSwap[] = [];
const listeners = new Set<() => void>();
const expiries = new Map<string, ReturnType<typeof setTimeout>>();

function publish(next: PendingSwap[]) {
  pending = next;
  listeners.forEach((listener) => listener());
}

function expireAfter(signature: string, ms: number) {
  clearTimeout(expiries.get(signature));
  expiries.set(
    signature,
    setTimeout(() => removePendingSwap(signature), ms)
  );
}

export function addPendingSwap(swap: PendingSwap): void {
  publish([swap, ...pending.filter((s) => s.signature !== swap.signature)]);
  expireAfter(swap.signature, PENDING_SWAP_TTL_MS);
}

/**
 * Marks a swap as landed, the moment this phone sees the chain confirm it,
 * and with what came back once that is read.
 */
export function settlePendingSwap(signature: string, receivedRaw?: string) {
  if (!pending.some((swap) => swap.signature === signature)) return;
  publish(
    pending.map((swap) =>
      swap.signature === signature
        ? {
            ...swap,
            settled: true,
            receivedRaw: receivedRaw ?? swap.receivedRaw,
          }
        : swap
    )
  );
  expireAfter(signature, SETTLED_SWAP_TTL_MS);
}

export function removePendingSwap(signature: string): void {
  clearTimeout(expiries.get(signature));
  expiries.delete(signature);
  if (!pending.some((swap) => swap.signature === signature)) return;
  publish(pending.filter((swap) => swap.signature !== signature));
}

/** Forgets every pending swap, for when the Account on this phone changes. */
export function clearPendingSwaps(): void {
  expiries.forEach((timer) => clearTimeout(timer));
  expiries.clear();
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
