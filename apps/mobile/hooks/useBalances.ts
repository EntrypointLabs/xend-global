import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/utils/apiClient";
import {
  selectStablecoinTotal,
  selectUsdc,
  selectDecimalsByMint,
} from "@/utils/balances";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";

export { selectStablecoinTotal, selectUsdc, selectDecimalsByMint };

/**
 * Token balances for the signed-in wallet, plus the derived headline totals the
 * home screen reads. Gated on `isAuthenticated` (the JWT scopes the fetch
 * server-side) rather than on the address, which is null for a beat on cold
 * start.
 */
export function useBalances() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();

  const query = useQuery({
    queryKey: ["balances", userId],
    // Arrow-wrapped: apiClient methods rely on their receiver.
    queryFn: () => apiClient.getBalances(),
    enabled: Boolean(isAuthenticated),
    staleTime: 30000,
  });

  const tokens = query.data?.tokens;
  const total = selectStablecoinTotal(tokens);
  const usdc = selectUsdc(tokens);
  const decimalsByMint = selectDecimalsByMint(tokens);
  const totalDisplay = total.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return {
    tokens: tokens ?? [],
    total,
    totalDisplay,
    usdc,
    decimalsByMint,
    balance: total,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
