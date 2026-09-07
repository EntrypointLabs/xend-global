import { useAuth } from "@/contexts/AuthContext";
import { useAccount } from "@/hooks/useAccount";

/**
 * The Consumer's address: what they receive at, and what their balance is read
 * from. Null until the backend has answered with the Account.
 *
 * This is the Squads vault PDA, which no single key controls. It is never the
 * Privy embedded wallet: that key is a signer, not the Account, and money sent
 * to it sits outside the signer set. A session the backend has not confirmed
 * yet shows no address rather than the wrong one.
 *
 * This is deliberately not the signing address. Privy signs, and the send flow
 * reaches its wallet through {@link usePrimarySignerAddress} or through Privy
 * directly. Conflating the two would try to sign as a PDA, which has no key.
 */
export function useWalletAddress(): string | null {
  const { data: account } = useAccount();

  return account?.address ?? null;
}

/** S1's address. Signs every spend; never the address a Consumer hands out. */
export function usePrimarySignerAddress(): string | null {
  const { wallet, user } = useAuth();
  return wallet ?? user?.walletAddress ?? null;
}
