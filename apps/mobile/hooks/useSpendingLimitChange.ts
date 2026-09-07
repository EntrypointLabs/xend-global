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
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { assertSettings } from "@/utils/verifyTransaction";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import {
  apiClient,
  type AccountResponse,
  type SpendingLimitChangeStep,
} from "@/utils/apiClient";

/** Propose, approve, approve, then execute a day later, plus one re-signature. */
const MAX_STEPS = 6;

export interface SpendingLimitChangeOutcome {
  /** Set when the change is serving out the time lock. ISO-8601. */
  waitingUntil: string | null;
  finished: boolean;
}

export type SpendingLimitChangeRequest =
  | { maxPerPeriod: string }
  | { remove: true };

type SolanaProvider = {
  request: (args: {
    method: "signTransaction";
    params: { transaction: VersionedTransaction };
  }) => Promise<{ signedTransaction: VersionedTransaction }>;
};

/**
 * Walks the Spending Limit change as far as this device can take it.
 *
 * It has to run here rather than on the server: the change needs two of the
 * Account's three signers and both of those live on the phone. The backend
 * holds the third, which is deliberately not one of the two.
 *
 * `first` is the step the editor already has in hand from staging the change,
 * so a Consumer who has just tapped Save is not made to wait for a round trip
 * that would return the step they were handed a moment ago.
 */
export async function runSpendingLimitChange(
  account: AccountResponse,
  provider: SolanaProvider,
  first?: SpendingLimitChangeStep,
  onStaged?: (changeIndex: string) => void
): Promise<SpendingLimitChangeOutcome> {
  let steps = 0;
  let plan = first;

  for (;;) {
    plan = plan ?? (await apiClient.nextSpendingLimitChangeStep());
    if (plan.done) return { waitingUntil: null, finished: true };

    // The alarm reads the chain and cannot tell who staged a change, so the
    // device that did has to say so. Recorded on every pass: cheap, and a
    // resumed walk must not leave the phone shouting at itself.
    if (plan.changeIndex) onStaged?.(plan.changeIndex);

    if (plan.step === "waiting") {
      return { waitingUntil: plan.executableAt ?? null, finished: false };
    }

    if (!plan.unsignedTxBase64) {
      throw new Error(
        `Spending limit step ${plan.step} carried no transaction`
      );
    }
    if (++steps > MAX_STEPS) {
      throw new Error(
        `Spending limit change did not finish in ${MAX_STEPS} steps; stuck on ${plan.step}`
      );
    }

    // The step does not name the amount, so bound what the change may do: one
    // spending rule is set up, rewritten or taken away, and no key joins or
    // leaves the Account on the back of it.
    assertSettings(plan.unsignedTxBase64, {
      vault: account.address,
      policyCreates: plan.creating ? 1 : 0,
      policyUpdates: plan.removing || plan.creating ? 0 : 1,
      policyRemovals: plan.removing ? 1 : 0,
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

    await apiClient.submitSpendingLimitChangeStep({
      signedTxBase64: fromByteArray(signed.serialize()),
    });
    plan = undefined;
  }
}

/** Everything a completed walk makes stale. */
function invalidateAfterChange(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: PENDING_CHANGE_KEY });
}

/**
 * The Consumer setting a new limit or taking it off, which is a thing they
 * just did.
 *
 * Staging and walking are one action here rather than two screens: the change
 * is announced the moment it is staged, so leaving it proposed but unapproved
 * would tell the Consumer something started and then stall it.
 */
export function useSpendingLimitChange() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { recordStarted } = useInitiatedChanges();

  return useMutation({
    mutationFn: async ({
      account,
      request,
    }: {
      account: AccountResponse;
      request: SpendingLimitChangeRequest;
    }): Promise<SpendingLimitChangeOutcome> => {
      const wallet = embeddedSolana.wallets?.[0];
      if (!wallet) throw new Error("Signing key not ready");
      // The provider first, and only then the staging call. A change is
      // announced the moment it is staged, so failing to reach the signer
      // afterwards would leave the Consumer holding a notice for a change
      // this device never started walking.
      const provider = (await wallet.getProvider()) as SolanaProvider;
      const first = await apiClient.startSpendingLimitChange(request);
      return runSpendingLimitChange(account, provider, first, recordStarted);
    },
    // Settled rather than success: a change that failed part way through has
    // still moved, and the screen has to show where it actually got to.
    onSettled: () => invalidateAfterChange(queryClient),
  });
}

/**
 * Lands a Spending Limit change whose security delay has run out.
 *
 * A query rather than an effect, for the reason the recovery key equivalent
 * gives: "run this once, only when these conditions hold, without racing
 * itself" is what a query key plus `enabled` already express.
 */
export function useFinishSpendingLimitChange() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { data: account } = useAccount();
  const { data: change } = usePendingAccountChange();

  const wallet = embeddedSolana.wallets?.[0];

  return useQuery({
    queryKey: [
      "spending-limit-change",
      "finish",
      change?.transactionIndex ?? "none",
    ],
    queryFn: async () => {
      const outcome = await runSpendingLimitChange(
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
