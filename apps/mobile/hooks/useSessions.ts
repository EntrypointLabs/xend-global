import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiClient } from "@/utils/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";

/**
 * The merchant Sessions the signed-in Consumer has granted. Gated on auth and
 * keyed per user, matching the transfers-query convention.
 */
export function useSessions() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  return useQuery({
    queryKey: ["sessions", userId],
    queryFn: () => apiClient.listSessions(),
    enabled: Boolean(isAuthenticated),
    staleTime: 15000,
  });
}

/**
 * Revoke a merchant Session. Invalidate-on-success (no optimistic update): the
 * row stays visible until the server confirms, so the list never silently
 * drops a Session that is still live. On failure the cache is left untouched
 * and the screen surfaces the error.
 */
export function useRevokeSession() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.revokeSession(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["sessions", userId] }),
  });
}
