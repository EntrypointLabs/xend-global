import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { apiClient } from "@/utils/apiClient";

export function useFiatRoutes() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  return useQuery({
    queryKey: ["fiat", "routes", userId],
    queryFn: () => apiClient.fiatRoutes(),
    enabled: Boolean(isAuthenticated),
  });
}
export function useFiatOrders() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  return useQuery({
    queryKey: ["fiat", "orders", userId],
    queryFn: () => apiClient.fiatOrders(),
    enabled: Boolean(isAuthenticated),
    refetchInterval: 5000,
  });
}
export function useFiatOrder(id: string | null) {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  return useQuery({
    queryKey: ["fiat", "order", userId, id],
    queryFn: () => apiClient.fiatOrder(id!),
    enabled: Boolean(isAuthenticated && id),
    refetchInterval: 5000,
  });
}
