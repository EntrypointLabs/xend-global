import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { VersionedTransaction } from "@solana/web3.js";
import { toByteArray, fromByteArray } from "base64-js";
import { Buffer } from "buffer";

import { ACCOUNT_QUERY_KEY } from "@/hooks/useAccount";
import { PENDING_CHANGE_KEY } from "@/hooks/usePendingAccountChange";
import { RECOVERY_KEYS_QUERY_KEY } from "@/hooks/useRecoveryKeys";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import {
  apiClient,
  type AccountResponse,
  type RecoveryChangeStep,
} from "@/utils/apiClient";

/**
 * Propose, approve, approve, then execute a day later. Six absorbs a step that
 * has to be re-signed.
 *
 * The bound is what stops a disagreement between the device and the chain from
 * becoming an endless loop of prompts.
 */
const MAX_STEPS = 6;

export interface RecoveryChangeOutcome {
  /** Set when the change is serving out the time lock. ISO-8601. */
  waitingUntil: string | null;
  finished: boolean;
}

/**
 * Drives the settings change that adds or removes a recovery key.
 *
 * On the device for the same reason provisioning is: the change needs two of
 * the Account's three signers, and S1 and S2 both live here. The backend holds
 * S3, which is deliberately not one of the two.
 *
 * Stops at `waiting` rather than blocking. The time lock is a day, so the
 * change is finished on a later launch by {@link useRecoveryChange} being run
 * again, not by keeping the Consumer on the screen.
 */
export function useRecoveryChange() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();

  return useMutation({
    mutationFn: async (
      account: AccountResponse
    ): Promise<RecoveryChangeOutcome> => {
      const wallet = embeddedSolana.wallets?.[0];
      if (!wallet) throw new Error("Wallet not ready");
      const provider = await wallet.getProvider();

      let steps = 0;
      for (;;) {
        const plan: RecoveryChangeStep =
          await apiClient.nextRecoveryChangeStep();
        if (plan.done) return { waitingUntil: null, finished: true };

        if (plan.step === "waiting") {
          return {
            waitingUntil: plan.executableAt ?? null,
            finished: false,
          };
        }

        if (!plan.unsignedTxBase64) {
          throw new Error(
            `Recovery key step ${plan.step} carried no transaction`
          );
        }
        if (++steps > MAX_STEPS) {
          throw new Error(
            `Recovery key change did not finish in ${MAX_STEPS} steps; stuck on ${plan.step}`
          );
        }

        let tx = VersionedTransaction.deserialize(
          toByteArray(plan.unsignedTxBase64)
        );

        // S2 before S1: Turnkey's activity is specified as unsigned in, signed
        // out, and its policy engine should evaluate the payload it approves.
        if (plan.needsApprovalSignature) {
          const signedHex = await signWithApprovalSigner({
            organizationId: account.approvalSubOrgId,
            signWith: account.signers.approval,
            unsignedTransaction: Buffer.from(
              toByteArray(plan.unsignedTxBase64)
            ).toString("hex"),
            prompt: SIGN_PROMPT.accountSetup,
          });
          tx = VersionedTransaction.deserialize(Buffer.from(signedHex, "hex"));
        }

        // Only when S1 actually has a slot. Handing Privy a transaction its key
        // does not appear in fails the step outright.
        const signed = requiresPrimary(tx, account.signers.primary)
          ? (
              await provider.request({
                method: "signTransaction",
                params: { transaction: tx },
              })
            ).signedTransaction
          : tx;

        await apiClient.submitRecoveryChangeStep({
          signedTxBase64: fromByteArray(signed.serialize()),
        });
      }
    },
    onSettled: () => {
      // Settled rather than success: a change that failed part way through has
      // still moved, and the screen has to show where it actually got to.
      queryClient.invalidateQueries({ queryKey: RECOVERY_KEYS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: PENDING_CHANGE_KEY });
      queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
    },
  });
}

/**
 * Whether this step carries a signature slot for the primary signer.
 *
 * Read off the compiled message rather than inferred from the step name: the
 * backend decides who signs what, and the fee payer is the settlement
 * authority rather than S1.
 */
function requiresPrimary(tx: VersionedTransaction, primary: string): boolean {
  return tx.message.staticAccountKeys
    .slice(0, tx.message.header.numRequiredSignatures)
    .some((key) => key.toBase58() === primary);
}
