import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toByteArray, fromByteArray } from "base64-js";
import { Buffer } from "buffer";

import { ACCOUNT_QUERY_KEY, useAccount } from "@/hooks/useAccount";
import { PENDING_CHANGE_KEY } from "@/hooks/usePendingAccountChange";
import { useInitiatedChanges } from "@/hooks/useInitiatedChange";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { assertSettings } from "@/utils/verifyTransaction";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import { apiClient, type AccountResponse } from "@/utils/apiClient";

/** Propose, approve, then execute a day later. Slack for a re-signed step. */
const MAX_STEPS = 5;

export interface ReplacePasskeyOutcome {
  /** Set when the swap is serving out the time lock. ISO-8601. */
  waitingUntil: string | null;
  finished: boolean;
}

/**
 * Walks the swap that replaces the Account's passkey.
 *
 * Every step this device signs is the Device Key's: the passkey being
 * replaced is gone, so the pair meeting the threshold is this phone and the
 * recovery signer, whose approval the backend produces against the emailed
 * code and which never reaches this loop.
 */
export async function runPrimaryRotation(
  account: AccountResponse,
  grantId?: string
): Promise<ReplacePasskeyOutcome> {
  let steps = 0;

  for (;;) {
    const plan = await apiClient.nextPrimaryRotationStep(grantId);
    if (plan.done) return { waitingUntil: null, finished: true };

    if (plan.step === "waiting") {
      return { waitingUntil: plan.executableAt ?? null, finished: false };
    }

    if (!plan.unsignedTxBase64) {
      throw new Error(`Replacement step ${plan.step} carried no transaction`);
    }
    if (++steps > MAX_STEPS) {
      throw new Error(
        `Replacement did not finish in ${MAX_STEPS} steps; stuck on ${plan.step}`
      );
    }

    assertSettings(plan.unsignedTxBase64, {
      vault: account.address,
      addSigners: plan.newPrimarySigner ? [plan.newPrimarySigner] : [],
      removeSigners: [account.signers.primary],
      policyUpdates: 2,
    });

    const signedHex = await signWithApprovalSigner({
      organizationId: account.approvalSubOrgId,
      signWith: account.signers.approval,
      unsignedTransaction: Buffer.from(
        toByteArray(plan.unsignedTxBase64)
      ).toString("hex"),
      prompt: SIGN_PROMPT.replacePasskey,
    });

    await apiClient.submitPrimaryRotationStep({
      signedTxBase64: fromByteArray(Buffer.from(signedHex, "hex")),
    });
  }
}

function invalidateAfterReplacement(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: PENDING_CHANGE_KEY });
}

export function useReplacePasskey() {
  const queryClient = useQueryClient();
  const { data: account } = useAccount();
  const { recordStarted } = useInitiatedChanges();

  return useMutation({
    mutationFn: async (input: {
      grantId: string;
      privyIdToken: string;
    }): Promise<ReplacePasskeyOutcome> => {
      if (!account) throw new Error("Account not loaded");

      const staged = await apiClient.startPrimaryRotation(input);
      if (staged.done) return { waitingUntil: null, finished: true };
      // Written down before a step is signed, so the pending-change alarm
      // stays quiet on the phone that asked for this.
      if (staged.changeIndex) recordStarted(staged.changeIndex);

      return runPrimaryRotation(account, input.grantId);
    },
    onSettled: () => invalidateAfterReplacement(queryClient),
  });
}

/**
 * Lands a staged replacement once its delay has run out.
 *
 * The execute step is signed by the Device Key on this phone, so nothing on
 * the server can finish it; it can only happen when Xend is next opened.
 */
export function useFinishPrimaryRotation() {
  const queryClient = useQueryClient();
  const { data: account } = useAccount();

  useQuery({
    queryKey: ["primary-rotation", "finish", account?.pendingPrimarySigner],
    enabled: !!account?.pendingPrimarySigner,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const outcome = await runPrimaryRotation(account!);
      if (outcome.finished) invalidateAfterReplacement(queryClient);
      return outcome;
    },
  });
}
