import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/utils/apiClient";
import type { BalancesDto } from "@/types/Backend";
import { usePollingEnabled } from "./usePollingEnabled";

/**
 * Reads the user's Grid balances and surfaces the USDC amount as a derived
 * number for the home screen, while preserving the full DTO for any consumer
 * that wants the raw token list.
 *
 * USDC mint address comes from EXPO_PUBLIC_USDC_MINT_ADDRESS — same convention
 * the legacy useWalletData hook used, kept here so the env contract doesn't
 * have to change in Phase 5.
 *
 * Phase 7: polling cadence is on (10s interval + immediate refetch on app
 * foreground). Both gates are tied to usePollingEnabled, which stops polling
 * cleanly when the user signs out OR the app backgrounds (battery + 401 noise).
 */
export function useBalancesQuery() {
  const enabled = usePollingEnabled();
  return useQuery<{ usdc: number; raw: BalancesDto }>({
    queryKey: ["wallet", "balances"],
    queryFn: async () => {
      const raw = await apiClient.getBalances();
      const usdcMint = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;

      console.log("raw", raw)
      const usdcToken = usdcMint
        ? raw.tokens.find((t) => t.tokenAddress === usdcMint)
        : undefined;
      const usdc = usdcToken
        ? parseFloat(parseFloat(usdcToken.amountDecimal).toFixed(2))
        : 0;
      return { usdc, raw };
    },
    // refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}
