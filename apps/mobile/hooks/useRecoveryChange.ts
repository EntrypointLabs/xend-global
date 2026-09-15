import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { VersionedTransaction } from "@solana/web3.js";
import { toByteArray, fromByteArray } from "base64-js";
import { Buffer } from "buffer";

import { ACCOUNT_QUERY_KEY, useAccount } from "@/hooks/useAccount";
import {
  PENDING_CHANGE_KEY,
  usePendingAccountChange,
} from "@/hooks/usePendingAccountChange";
import { useInitiatedChanges } from "@/hooks/useInitiatedChange";
import { RECOVERY_KEYS_QUERY_KEY } from "@/hooks/useRecoveryKeys";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { assertSettings } from "@/utils/verifyTransaction";
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

type SolanaProvider = {
  request: (args: {
    method: "signTransaction";
    params: { transaction: VersionedTransaction };
  }) => Promise<{ signedTransaction: VersionedTransaction }>;
};

/**
 * Walks the change as far as this device can take it, then stops.
 *
 * It has to run here rather than on the server: the change needs two of the
 * Account's three signers and both of those live on the phone. The backend
 * holds S3, which is deliberately not one of the two.
 *
 * Two callers, one walk. Adding a key runs it up to the time lock; opening the
 * app a day later runs the rest.
 */
export async function runRecoveryChange(
  account: AccountResponse,
  provider: SolanaProvider,
  onStaged?: (changeIndex: string) => void
): Promise<RecoveryChangeOutcome> {
  let steps = 0;

  for (;;) {
    const plan: RecoveryChangeStep = await apiClient.nextRecoveryChangeStep();
    if (plan.done) return { waitingUntil: null, finished: true };

    // The alarm reads the chain and cannot tell who staged a change, so the
    // device that did has to say so. Recorded on every pass: cheap, and a
    // resumed walk must not leave the phone shouting at itself.
    if (plan.changeIndex) onStaged?.(plan.changeIndex);

    if (plan.step === "waiting") {
      return { waitingUntil: plan.executableAt ?? null, finished: false };
    }

    if (!plan.unsignedTxBase64) {
      throw new Error(`Recovery key step ${plan.step} carried no transaction`);
    }
    if (++steps > MAX_STEPS) {
      throw new Error(
        `Recovery key change did not finish in ${MAX_STEPS} steps; stuck on ${plan.step}`
      );
    }

    // The step does not name the key, so bound what the change may do: one
    // recovery key moves, and nothing touches the spending rules or the lock.
    assertSettings(plan.unsignedTxBase64, {
      vault: account.address,
      maxAddSigners: 1,
      maxRemoveSigners: 1,
      policyUpdates: 1,
    });

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
}

/** Everything a completed walk makes stale. */
function invalidateAfterChange(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: RECOVERY_KEYS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: PENDING_CHANGE_KEY });
  queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
}

/** The Consumer adding or removing a key, which is a thing they just did. */
export function useRecoveryChange() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { recordStarted } = useInitiatedChanges();

  return useMutation({
    mutationFn: async (
      account: AccountResponse
    ): Promise<RecoveryChangeOutcome> => {
      const wallet = embeddedSolana.wallets?.[0];
      if (!wallet) throw new Error("Wallet not ready");
      return runRecoveryChange(
        account,
        (await wallet.getProvider()) as SolanaProvider,
        recordStarted
      );
    },
    // Settled rather than success: a change that failed part way through has
    // still moved, and the screen has to show where it actually got to.
    onSettled: () => invalidateAfterChange(queryClient),
  });
}

/**
 * Lands a change whose security delay has run out.
 *
 * A query rather than an effect. "Run this once, only when these conditions
 * hold, without racing itself" is exactly what a query key plus `enabled`
 * already express, and hand-rolling it with a ref would reimplement the parts
 * that are easy to get wrong.
 *
 * Keyed on the change, so a later one is a different query and runs on its own
 * merits. `staleTime: Infinity` and no refetching mean one attempt per change
 * per launch: a failure that retried on every render would be a stream of
 * transactions, not a retry.
 */
export function useFinishRecoveryChange() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { data: account } = useAccount();
  const { data: change } = usePendingAccountChange();

  const wallet = embeddedSolana.wallets?.[0];

  return useQuery({
    queryKey: ["recovery-change", "finish", change?.transactionIndex ?? "none"],
    queryFn: async () => {
      const outcome = await runRecoveryChange(
        account as AccountResponse,
        (await wallet!.getProvider()) as SolanaProvider
      );
      invalidateAfterChange(queryClient);
      return outcome;
    },
    // Whether the delay has run out is the server's call, not this device's.
    // It reads the deadline off the chain, and a phone with a skewed clock
    // must not be the thing that decides a security delay is over. Asking
    // early is cheap: the walk gets `waiting` back and stops without signing.
    enabled: !!account && !!wallet && change?.selfInitiated === true,
    // Retried when the app comes forward, which is the only moment the answer
    // can have changed, and never in a render loop.
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
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
