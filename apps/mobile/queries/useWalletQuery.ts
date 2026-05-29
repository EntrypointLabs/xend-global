import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/utils/apiClient";
import type { WalletDto } from "@/types/Backend";

/**
 * Reads the user's wallet (id, gridAccountId, Grid account metadata) once and
 * caches it indefinitely. The smart-account address does not change session-to-
 * session, so polling is wasteful — Phase 7 deliberately does NOT add a
 * refetchInterval here. Mutations (re-keying, etc.) would have to invalidate
 * ['wallet','me'] explicitly.
 */
export function useWalletQuery() {
  return useQuery<WalletDto>({
    queryKey: ["wallet", "me"],
    queryFn: () => apiClient.getWallet(),
    staleTime: Infinity,
    retry: 2
  });
}
