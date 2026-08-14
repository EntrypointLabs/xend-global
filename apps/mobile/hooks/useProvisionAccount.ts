import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { VersionedTransaction } from "@solana/web3.js";
import { toByteArray, fromByteArray } from "base64-js";
import { Buffer } from "buffer";

import { ACCOUNT_QUERY_KEY } from "@/hooks/useAccount";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { apiClient, type AccountResponse } from "@/utils/apiClient";

/**
 * A settings change is proposed, approved by two signers, then executed, and
 * there are three of them. Twelve is the whole sequence; the slack absorbs a
 * step that has to be re-signed.
 *
 * The bound is what stops a disagreement between the device and the chain from
 * becoming an endless loop of prompts: if the backend keeps returning a step
 * the chain never records, this gives up instead of asking forever.
 */
const MAX_STEPS = 16;

/**
 * Walks a new Account through the settings changes that make it spendable.
 *
 * Provisioning has to happen here rather than on the backend because every
 * step is a settings change, and a settings change needs two of the Account's
 * three signers. The backend holds only S3 by design; S1 and S2 are both on
 * this device, which makes the device the only place that can reach threshold.
 *
 * One biometric prompt per change, three in total: S1 signs every step, and S2
 * is asked only for its own approval.
 */
export function useProvisionAccount() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();

  return useMutation({
    mutationFn: async (account: AccountResponse) => {
      const wallet = embeddedSolana.wallets?.[0];
      if (!wallet) throw new Error("Wallet not ready");
      const provider = await wallet.getProvider();

      let steps = 0;
      for (;;) {
        const plan = await apiClient.nextProvisioningStep();
        if (plan.done) return steps;

        if (!plan.unsignedTxBase64) {
          throw new Error(
            `Provisioning step ${plan.step} carried no transaction`
          );
        }
        if (++steps > MAX_STEPS) {
          throw new Error(
            `Provisioning did not finish in ${MAX_STEPS} steps; stuck on ${plan.change}/${plan.step}`
          );
        }

        let tx = VersionedTransaction.deserialize(
          toByteArray(plan.unsignedTxBase64)
        );

        // S2 before S1, for the same reason as a Spend: Turnkey's activity is
        // specified as unsigned in, signed out, and its policy engine should
        // evaluate the payload it is actually approving.
        if (plan.needsApprovalSignature) {
          const signedHex = await signWithApprovalSigner({
            organizationId: account.approvalSubOrgId,
            signWith: account.signers.approval,
            unsignedTransaction: Buffer.from(
              toByteArray(plan.unsignedTxBase64)
            ).toString("hex"),
          });
          tx = VersionedTransaction.deserialize(Buffer.from(signedHex, "hex"));
        }

        // S1 signs every step: it approves, it executes, and it pays the fee.
        const { signedTransaction } = await provider.request({
          method: "signTransaction",
          params: { transaction: tx },
        });

        await apiClient.submitProvisioningStep({
          signedTxBase64: fromByteArray(signedTransaction.serialize()),
        });
      }
    },
    onSuccess: () => {
      // The spend route depends on the policies this just created, so anything
      // that read the Account before provisioning is now stale.
      queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
    },
  });
}
