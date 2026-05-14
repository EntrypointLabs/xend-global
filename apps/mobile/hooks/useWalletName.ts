import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StorageService } from "@/utils/storage";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";

const QUERY_KEY = ["walletName"] as const;
const DEFAULT_NAME = "Wallet";

export function useWalletName() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const stored = await StorageService.getItem<string>(
        AUTH_STORAGE_KEYS.WALLET_NAME
      );
      return stored ?? DEFAULT_NAME;
    },
    staleTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: async (name: string) => {
      await StorageService.setItem(AUTH_STORAGE_KEYS.WALLET_NAME, name);
      return name;
    },
    onSuccess: (name) => {
      queryClient.setQueryData(QUERY_KEY, name);
    },
  });

  return {
    name: query.data ?? DEFAULT_NAME,
    setName: mutation.mutate,
    isLoading: query.isLoading,
  };
}
