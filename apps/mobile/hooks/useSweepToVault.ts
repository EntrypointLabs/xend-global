import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { VersionedTransaction } from "@solana/web3.js";
import { fromByteArray, toByteArray } from "base64-js";

import { apiClient } from "@/utils/apiClient";

/**
 * Moves whatever is left in the Privy embedded wallet into the vault.
 *
 * Privy signs, so this runs on the device: the backend holds no key that can
 * move these funds and deliberately has no way to. It reuses the ordinary
 * transfer path, because a sweep is just a transfer whose destination happens
 * to be the Consumer's own Account.
 *
 * Safe to call more than once. An empty Privy wallet plans nothing, and each
 * mint is transferred in full, so a retry after a partial sweep moves only what
 * is still there.
 */
export function useSweepToVault() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();

  return useMutation({
    mutationFn: async () => {
      const plan = await apiClient.getSweepPlan();
      if (!plan.needed || !plan.destination) return { swept: 0 };

      const wallet = embeddedSolana.wallets?.[0];
      if (!wallet) throw new Error("Wallet not ready");
      const provider = await wallet.getProvider();

      let swept = 0;
      for (const balance of plan.balances) {
        const prepared = await apiClient.prepareTransfer({
          toAddress: plan.destination,
          mint: balance.mint,
          amountRaw: balance.amountRaw,
        });

        const tx = VersionedTransaction.deserialize(
          toByteArray(prepared.unsignedTxBase64)
        );
        const { signedTransaction } = await provider.request({
          method: "signTransaction",
          params: { transaction: tx },
        });

        await apiClient.submitTransfer({
          intentId: prepared.intentId,
          signedTxBase64: fromByteArray(signedTransaction.serialize()),
        });
        swept++;
      }

      return { swept };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });
}
