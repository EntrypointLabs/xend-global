import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VersionedTransaction } from "@solana/web3.js";
import { fromByteArray, toByteArray } from "base64-js";

import { useAuth } from "@/contexts/AuthContext";
import { useAccount } from "@/hooks/useAccount";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import { apiClient } from "@/utils/apiClient";
import { Buffer } from "buffer";

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
 * Rejects the staged change, signing with S2 and then S1.
 *
 * Both, because one is not a refusal. The Account needs 2 of 3 to settle a
 * proposal either way, so a rejection carrying a single signature is recorded
 * against the change and leaves it open, which reads to the Consumer as a
 * refusal that did nothing.
 *
 * So it costs a biometric prompt. That is a worse first impression than the
 * one-tap version it replaces and a better outcome than a button that says
 * "reject" and does not.
 */
export function useRejectAccountChange() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { data: account } = useAccount();

  return useMutation({
    mutationFn: async () => {
      const wallet = embeddedSolana.wallets?.[0];
      if (!wallet) throw new Error("Wallet not ready");
      if (!account) throw new Error("Account not ready");
      const provider = await wallet.getProvider();

      const prepared = await apiClient.prepareChangeRejection();

      // S2 before S1, matching the order the backend compiled and the order
      // Turnkey's policy engine expects: unsigned in, signed out.
      const approved = await signWithApprovalSigner({
        organizationId: account.approvalSubOrgId,
        signWith: account.signers.approval,
        unsignedTransaction: Buffer.from(
          toByteArray(prepared.unsignedTxBase64)
        ).toString("hex"),
        prompt: SIGN_PROMPT.rejectChange,
      });

      const { signedTransaction } = await provider.request({
        method: "signTransaction",
        params: {
          transaction: VersionedTransaction.deserialize(
            Buffer.from(approved, "hex")
          ),
        },
      });

      return apiClient.submitChangeRejection({
        signedTxBase64: fromByteArray(signedTransaction.serialize()),
      });
    },
    // The screen shows one message for every failure, so without this the
    // reason is gone. It matters here more than most: the device key refusing
    // to stamp and the network being down look identical to the Consumer, and
    // only one of them is worth retrying.
    onError: (error) =>
      console.error("[reject] change was not rejected", error),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PENDING_CHANGE_KEY });
    },
  });
}
