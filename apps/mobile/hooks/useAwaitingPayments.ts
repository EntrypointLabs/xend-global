import { useQuery } from "@tanstack/react-query";

import { useAccount } from "@/hooks/useAccount";
import { apiClient } from "@/utils/apiClient";

export const AWAITING_PAYMENTS_KEY = ["payments", "awaiting"] as const;

/**
 * Payments a Merchant is waiting on that only this phone can finish.
 *
 * A Payment larger than one signature carries needs the approval signer, which
 * lives here and nowhere the checkout can reach. Somebody who just tapped "Pay
 * with Xend" and was told to open the app is standing at a till, so this is
 * checked often rather than cached for comfort.
 */
export function useAwaitingPayments() {
  const { data: account } = useAccount();

  return useQuery({
    queryKey: [...AWAITING_PAYMENTS_KEY, account?.address ?? null],
    queryFn: () => apiClient.listAwaitingPayments(),
    enabled: !!account,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
  });
}
