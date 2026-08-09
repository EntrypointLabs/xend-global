import { useAuth } from "@/contexts/AuthContext";
import { useAccount } from "@/hooks/useAccount";

/**
 * The Consumer's address: what they receive at, and what their balance is read
 * from.
 *
 * Once an Account exists this is the Squads vault PDA, which no single key
 * controls. Before enrolment it falls back to the Privy embedded wallet, which
 * is where a pre-multisig balance still sits.
 *
 * This is deliberately not the signing address. Privy signs, and the send flow
 * reaches its wallet through {@link usePrimarySignerAddress} or through Privy
 * directly. Conflating the two would try to sign as a PDA, which has no key.
 */
export function useWalletAddress(): string | null {
  const { wallet, user } = useAuth();
  const { data: account } = useAccount();

  return account?.address ?? wallet ?? user?.walletAddress ?? null;
}

/** S1's address. Signs every spend; never the address a Consumer hands out. */
export function usePrimarySignerAddress(): string | null {
  const { wallet, user } = useAuth();
  return wallet ?? user?.walletAddress ?? null;
}
