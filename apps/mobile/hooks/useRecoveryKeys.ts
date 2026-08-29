import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, type RecoveryKey } from "@/utils/apiClient";

export const RECOVERY_KEYS_QUERY_KEY = ["account", "recovery-keys"] as const;

/**
 * The Consumer's recovery keys, including any whose change is still in flight.
 *
 * A staged key is returned rather than hidden. It is not protecting anything
 * yet, and saying so is the honest thing to show: hiding it would have the
 * Consumer add a second one, hit the cap, and see no reason why.
 */
export function useRecoveryKeys() {
  return useQuery({
    queryKey: RECOVERY_KEYS_QUERY_KEY,
    queryFn: () => apiClient.getRecoveryKeys(),
  });
}

export function useAddRecoveryWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (address: string) => apiClient.addRecoveryWallet({ address }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: RECOVERY_KEYS_QUERY_KEY });
    },
  });
}

export function useRequestRecoveryEmailCode() {
  return useMutation({
    mutationFn: (email: string) => apiClient.requestRecoveryEmailCode(email),
  });
}

export function useVerifyRecoveryEmail() {
  return useMutation({
    mutationFn: (body: { email: string; code: string }) =>
      apiClient.verifyRecoveryEmail(body),
  });
}

export function useAddRecoveryEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { email: string; grantId: string }) =>
      apiClient.addRecoveryEmail(body),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: RECOVERY_KEYS_QUERY_KEY });
    },
  });
}

export function useRemoveRecoveryKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (key: RecoveryKey) => apiClient.removeRecoveryKey(key.id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: RECOVERY_KEYS_QUERY_KEY });
    },
  });
}
