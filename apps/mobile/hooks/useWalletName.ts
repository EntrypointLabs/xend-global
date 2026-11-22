import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StorageService, userScopedKey } from "@/utils/storage";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";
import { useUserId } from "@/hooks/useUserId";
import { apiClient } from "@/utils/apiClient";

const DEFAULT_NAME = "Account";

// Scoped to the signed-in user so each account keeps its own wallet name.
function walletNameKey(userId: string) {
  return userScopedKey(AUTH_STORAGE_KEYS.WALLET_NAME, userId);
}

export function useWalletName() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  const queryKey = ["walletName", userId] as const;
  const storageKey = userId ? walletNameKey(userId) : null;

  const query = useQuery({
    queryKey,
    enabled: !!storageKey,
    queryFn: async () => {
      if (!storageKey) return DEFAULT_NAME;
      const stored = await StorageService.getItem<string>(storageKey);
      return stored ?? DEFAULT_NAME;
    },
    staleTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: async (name: string) => {
      if (!storageKey) return name;
      const previous = query.data ?? DEFAULT_NAME;
      await StorageService.setItem(storageKey, name);
      // Best-effort: the rename has happened on the device either way, and a
      // missing Activity row is not worth failing the save over.
      if (name !== previous) {
        await apiClient.recordAccountRename(name, previous).catch(() => {});
      }
      return name;
    },
    onSuccess: (name) => {
      queryClient.setQueryData(queryKey, name);
      queryClient.invalidateQueries({ queryKey: ["transfers", userId] });
    },
  });

  return {
    name: query.data ?? DEFAULT_NAME,
    setName: mutation.mutate,
    isLoading: query.isLoading,
  };
}
