import { useAuth } from "@/contexts/AuthContext";

/**
 * The signed-in Solana wallet address. Prefers Privy's embedded wallet
 * (surfaced by AuthContext as `wallet`) but falls back to the persisted
 * `user.walletAddress`, since `wallet` is null for a beat on cold start.
 */
export function useWalletAddress(): string | null {
  const { wallet, user } = useAuth();
  return wallet ?? user?.walletAddress ?? null;
}
