import { useSyncExternalStore } from "react";

import { getUsdcMint } from "@/utils/cluster";
import { WRAPPED_SOL_MINT, type SwapToken } from "@/utils/swap";

export type SwapSide = "pay" | "receive";

export interface SwapPair {
  pay: SwapToken;
  receive: SwapToken;
}

/**
 * Puts `token` on one side of the pair. Choosing the asset already on the
 * other side turns the pair around: a swap of an asset for itself is never
 * what was meant, and refusing the tap would only make the Consumer do the
 * same thing in two steps.
 */
export function chooseToken(
  pair: SwapPair,
  side: SwapSide,
  token: SwapToken
): SwapPair {
  const other: SwapSide = side === "pay" ? "receive" : "pay";
  if (pair[other].mint === token.mint) {
    return { [side]: token, [other]: pair[side] } as unknown as SwapPair;
  }
  return { ...pair, [side]: token };
}

function startingPair(): SwapPair {
  return {
    pay: {
      mint: WRAPPED_SOL_MINT,
      symbol: "SOL",
      name: "Solana",
      decimals: 9,
      iconUrl: null,
    },
    receive: {
      mint: getUsdcMint(),
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      iconUrl: null,
    },
  };
}

// Shared outside React because the pair is chosen on one screen and used on
// another, and the Swap screen stays mounted underneath the picker.
let pair: SwapPair | null = null;
const listeners = new Set<() => void>();

function current(): SwapPair {
  pair ??= startingPair();
  return pair;
}

function set(next: SwapPair) {
  pair = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pickSwapToken(side: SwapSide, token: SwapToken) {
  set(chooseToken(current(), side, token));
}

export function flipSwapPair() {
  const { pay, receive } = current();
  set({ pay: receive, receive: pay });
}

export function useSwapPair(): SwapPair {
  return useSyncExternalStore(subscribe, current, current);
}
