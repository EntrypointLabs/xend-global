import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StorageService, userScopedKey } from "@/utils/storage";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";
import { useUserId } from "@/hooks/useUserId";

const DEFAULT_NAME = "Wallet";

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
      await StorageService.setItem(storageKey, name);
      return name;
    },
    onSuccess: (name) => {
      queryClient.setQueryData(queryKey, name);
    },
  });

  return {
    name: query.data ?? DEFAULT_NAME,
    setName: mutation.mutate,
    isLoading: query.isLoading,
  };
}
