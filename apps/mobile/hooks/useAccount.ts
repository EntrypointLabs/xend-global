import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/utils/apiClient";

export const ACCOUNT_QUERY_KEY = ["account", "me"] as const;

/**
 * The Consumer's Squads Account (ADR 0025), or null before enrolment.
 *
 * Cached hard: the vault address is assigned once at creation and never
 * changes, not on a signer rotation and not on a device change. Refetching it
 * on every screen would be a round trip for a constant.
 */
export function useAccount() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ACCOUNT_QUERY_KEY,
    queryFn: () => apiClient.getAccount(),
    enabled: !!user,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}
