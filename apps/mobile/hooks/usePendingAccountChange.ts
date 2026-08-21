import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VersionedTransaction } from "@solana/web3.js";
import { fromByteArray, toByteArray } from "base64-js";

import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/utils/apiClient";

export const PENDING_CHANGE_KEY = ["account", "pending-change"] as const;

/**
 * A settings change waiting on the Consumer's Account, if there is one.
 *
 * Polled as well as pushed. The push notification is how they find out while
 * the app is closed, but a Consumer with notifications off, or a stale token,
 * would otherwise never see the one notice that has to arrive, so opening Xend
 * asks as well.
 */
export function usePendingAccountChange() {
  const { user } = useAuth();

  return useQuery({
    queryKey: PENDING_CHANGE_KEY,
    queryFn: () => apiClient.getPendingAccountChange(),
    enabled: !!user,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

/**
 * Rejects the staged change, signing with S1.
 *
 * S1 rather than the hardware key: rejecting has to be the cheapest action in
 * the app. Someone looking at a change they did not make should not have to get
 * past a biometric prompt to refuse it.
 */
export function useRejectAccountChange() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();

  return useMutation({
    mutationFn: async () => {
      const wallet = embeddedSolana.wallets?.[0];
      if (!wallet) throw new Error("Wallet not ready");
      const provider = await wallet.getProvider();

      const prepared = await apiClient.prepareChangeRejection();
      const tx = VersionedTransaction.deserialize(
        toByteArray(prepared.unsignedTxBase64)
      );
      const { signedTransaction } = await provider.request({
        method: "signTransaction",
        params: { transaction: tx },
      });

      return apiClient.submitChangeRejection({
        signedTxBase64: fromByteArray(signedTransaction.serialize()),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PENDING_CHANGE_KEY });
    },
  });
}
