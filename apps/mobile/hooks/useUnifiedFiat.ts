import { localFiatDemo } from "@/utils/local-fiat-demo";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { apiClient } from "@/utils/apiClient";
export function useUnifiedFiat(displayCurrency: "USD" | "NGN") {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  return useQuery({
    queryKey: [
      "fiat",
      "unified",
      localFiatDemo ? "local-simulation" : userId,
      displayCurrency,
    ],
    queryFn: () => apiClient.unifiedFiat(displayCurrency),
    enabled: localFiatDemo || Boolean(isAuthenticated && userId),
    refetchInterval: 5000,
  });
}
