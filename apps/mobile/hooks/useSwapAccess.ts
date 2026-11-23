import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStagedSettingsChange } from "@prydd/smart-account";
import { VersionedTransaction } from "@solana/web3.js";
import { fromByteArray, toByteArray } from "base64-js";
import { Buffer } from "buffer";

import { useAuth } from "@/contexts/AuthContext";
import { useAccount } from "@/hooks/useAccount";
import { useInitiatedChanges } from "@/hooks/useInitiatedChange";
import { PENDING_CHANGE_KEY } from "@/hooks/usePendingAccountChange";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import {
  apiClient,
  type AccountResponse,
  type SwapAccessStep,
} from "@/utils/apiClient";
import { getSolanaConnection } from "@/utils/chainReads";
import {
  checkSwapAccess,
  proposalVotedOn,
  TransactionMismatchError,
} from "@/utils/verifyTransaction";

export const SWAP_ACCESS_KEY = ["account", "swap-access"] as const;

/** Staging, a re-signature if a blockhash lapses, and the execute. */
const MAX_STEPS = 4;

/** How often a waiting change is asked about while the app stays open. */
const WAITING_POLL_MS = 60_000;

type SolanaProvider = {
  request: (args: {
    method: "signTransaction";
    params: { transaction: VersionedTransaction };
  }) => Promise<{ signedTransaction: VersionedTransaction }>;
};

/**
 * Whether this Account can swap. An Account set up before Swap needs a
 * one-time change to its spending rules first, and that change waits out the
 * same 24 hour delay as any other.
 */
export function useSwapAccess() {
  const { user } = useAuth();

  return useQuery({
    queryKey: SWAP_ACCESS_KEY,
    queryFn: () => apiClient.getSwapAccess(),
    enabled: !!user,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

/**
 * Walks the change as far as this phone can take it right now.
 *
 * `unattended` is the walk that runs on its own once the delay is over. It
 * lands the execute, which the primary signs from its session, and stops
 * rather than raise a biometric prompt nobody asked for.
 */
async function runSwapAccess(
  account: AccountResponse,
  provider: SolanaProvider,
  options: {
    first?: SwapAccessStep;
    unattended?: boolean;
    onStaged?: (changeIndex: string) => void;
  } = {}
): Promise<{ finished: boolean }> {
  let plan = options.first;

  for (let steps = 0; ; steps++) {
    plan = plan ?? (await apiClient.nextSwapAccessStep());
    if (plan.done) return { finished: true };
    if (plan.changeIndex) options.onStaged?.(plan.changeIndex);
    if (plan.step === "waiting") return { finished: false };
    if (plan.needsApprovalSignature && options.unattended) {
      return { finished: false };
    }
    if (!plan.unsignedTxBase64 || steps >= MAX_STEPS) {
      throw new Error(`Turning Swap on stalled at ${plan.step}`);
    }

    // An approval or the execute does not say what it acts on, so the
    // change is read from this phone's own RPC: the backend is the party
    // being checked and cannot also be the one describing it.
    const voted = proposalVotedOn(plan.unsignedTxBase64, account.address);
    const staged = voted
      ? await fetchStagedSettingsChange(
          getSolanaConnection(),
          voted.settings,
          voted.proposal
        )
      : null;
    const mismatch = checkSwapAccess(
      plan.unsignedTxBase64,
      {
        vault: account.address,
        primary: account.signers.primary,
        approval: account.signers.approval,
      },
      staged
    );
    if (mismatch) throw new TransactionMismatchError(mismatch);

    let tx = VersionedTransaction.deserialize(
      toByteArray(plan.unsignedTxBase64)
    );
    // The approval signer first: Turnkey takes a transaction unsigned and
    // returns it signed, and the primary then fills its own slot.
    if (plan.needsApprovalSignature) {
      const signedHex = await signWithApprovalSigner({
        organizationId: account.approvalSubOrgId,
        signWith: account.signers.approval,
        unsignedTransaction: Buffer.from(
          toByteArray(plan.unsignedTxBase64)
        ).toString("hex"),
        prompt: SIGN_PROMPT.swapAccess,
      });
      tx = VersionedTransaction.deserialize(Buffer.from(signedHex, "hex"));
    }
    const { signedTransaction } = await provider.request({
      method: "signTransaction",
      params: { transaction: tx },
    });
    await apiClient.submitSwapAccessStep(
      fromByteArray(signedTransaction.serialize())
    );
    plan = undefined;
  }
}

/** The Consumer turning Swap on: one confirmation, then the delay. */
export function useTurnOnSwap() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { data: account } = useAccount();
  const { recordStarted } = useInitiatedChanges();

  return useMutation({
    mutationFn: async () => {
      const wallet = embeddedSolana.wallets?.[0];
      if (!wallet || !account) throw new Error("Account not ready");
      // The provider first, and only then the staging call: the change is
      // announced the moment it is staged, so failing to reach the signer
      // afterwards would leave a notice for a change nobody is walking.
      const provider = (await wallet.getProvider()) as SolanaProvider;
      const first = await apiClient.startSwapAccess();
      return runSwapAccess(account, provider, {
        first,
        onStaged: recordStarted,
      });
    },
    // Settled rather than success: a walk that failed part way has still
    // moved, and the screen has to show where it actually got to.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SWAP_ACCESS_KEY });
      queryClient.invalidateQueries({ queryKey: PENDING_CHANGE_KEY });
    },
  });
}

/**
 * Lands the change once its delay has run out.
 *
 * The execute is signed by the key on this phone, so nothing on the server
 * can do it. Whether the delay is over is the server's call, read off the
 * chain: asking early gets `waiting` back and signs nothing.
 */
export function useFinishSwapAccess() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { data: account } = useAccount();
  const { data: access } = useSwapAccess();

  const wallet = embeddedSolana.wallets?.[0];
  const pending = access?.state === "pending";

  return useQuery({
    queryKey: ["swap-access", "finish", access?.executableAt ?? "none"],
    queryFn: async () => {
      const outcome = await runSwapAccess(
        account as AccountResponse,
        (await wallet!.getProvider()) as SolanaProvider,
        { unattended: true }
      );
      if (outcome.finished) {
        queryClient.invalidateQueries({ queryKey: SWAP_ACCESS_KEY });
        queryClient.invalidateQueries({ queryKey: PENDING_CHANGE_KEY });
      }
      return outcome;
    },
    enabled: !!account && !!wallet && pending,
    refetchInterval: pending ? WAITING_POLL_MS : false,
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
  });
}
