import type { ImageSourcePropType } from "react-native";

import { getUsdcMint } from "@/utils/cluster";

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

export interface TokenIdentity {
  /** What a Consumer calls it: "Solana", not "SOL". */
  name: string;
  /** The ticker shown next to an amount. */
  symbol: string;
}

/**
 * Names for the mints this app knows about.
 *
 * A local table rather than an on-chain metadata fetch: the balance and
 * activity screens must render immediately, and a metadata round-trip per mint
 * would make them wait on a network call to say "Solana". Anything absent
 * falls back to its truncated mint, which is honest about not knowing.
 */
const KNOWN: Record<string, TokenIdentity> = {
  [WRAPPED_SOL_MINT]: { name: "Solana", symbol: "SOL" },
};

/**
 * Logos shipped with the app.
 *
 * These take precedence over anything fetched, because the token index covers
 * mainnet and a Consumer on a test network holds cluster-specific mints it
 * will never resolve.
 */
const LOCAL_ICONS: Record<string, ImageSourcePropType> = {};

export function localIconForMint(mint: string): ImageSourcePropType | null {
  if (mint === getUsdcMint()) return require("@/assets/icons/usdc.png");
  return LOCAL_ICONS[mint] ?? null;
}

function truncateMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function describeToken(
  mint: string,
  symbolHint?: string | null,
  nameHint?: string | null
): TokenIdentity {
  // Our own naming wins over the index. The index calls the wrapped-SOL mint
  // "Wrapped SOL", which is accurate about the token and wrong about what the
  // Consumer holds: to them it is simply Solana.
  const known = KNOWN[mint];
  if (known) return known;

  // Otherwise take the index, which names every asset rather than the handful
  // listed here.
  if (nameHint && symbolHint) return { name: nameHint, symbol: symbolHint };

  // The cluster's USDC mint changes per network, so it is resolved rather
  // than listed.
  if (mint === getUsdcMint()) return { name: "USD Coin", symbol: "USDC" };

  const fallback = symbolHint ?? truncateMint(mint);
  return { name: fallback, symbol: symbolHint ?? "" };
}

/**
 * A token amount as a Consumer reads it: "0.005", not "0.005000000".
 *
 * Trailing zeros are dropped because they imply a precision the number does
 * not carry, and a nine-decimal mint would otherwise fill the row.
 */
export function formatTokenAmount(amount: number, decimals: number): string {
  return amount.toLocaleString("en-US", {
    maximumFractionDigits: Math.min(decimals, 6),
  });
}
