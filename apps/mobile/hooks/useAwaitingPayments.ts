import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useAccount } from "@/hooks/useAccount";
import { apiClient } from "@/utils/apiClient";

export const AWAITING_PAYMENTS_KEY = ["payments", "awaiting"] as const;

/**
 * Payments a Merchant is waiting on that only this phone can finish.
 *
 * A Payment larger than one signature carries needs the approval signer, which
 * lives here and nowhere the checkout can reach. Somebody who just tapped "Pay
 * with Prydd" and was told to open the app is standing at a till, so this is
 * checked often rather than cached for comfort.
 */
/**
 * Whether this Consumer may ask for Payments waiting on them. A Payment is
 * finished with the passkey, which an entry session lacks, and the endpoint is
 * closed to it. Shared so a manual refetch honours the same gate the query does.
 */
export function useCanSeeAwaitingPayments(): boolean {
  const { sessionTier } = useAuth();
  const { data: account } = useAccount();
  return !!account && sessionTier === "full";
}

export function useAwaitingPayments() {
  const { data: account } = useAccount();
  const enabled = useCanSeeAwaitingPayments();

  return useQuery({
    queryKey: [...AWAITING_PAYMENTS_KEY, account?.address ?? null],
    queryFn: () => apiClient.listAwaitingPayments(),
    enabled,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
  });
}
