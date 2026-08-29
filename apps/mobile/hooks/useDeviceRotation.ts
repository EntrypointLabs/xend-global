import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { VersionedTransaction } from "@solana/web3.js";
import { toByteArray, fromByteArray } from "base64-js";

import { ACCOUNT_QUERY_KEY, useAccount } from "@/hooks/useAccount";
import { useInitiatedChanges } from "@/hooks/useInitiatedChange";
import { PENDING_CHANGE_KEY } from "@/hooks/usePendingAccountChange";
import { devicePlatform, hardwareKey } from "@/modules/hardware-key/src";
import { apiClient, type DeviceRotationStep } from "@/utils/apiClient";

/** Propose, approve, then execute a day later. Slack for a re-signed step. */
const MAX_STEPS = 5;

export interface DeviceRotationOutcome {
  /** Set when the swap is serving out the time lock. ISO-8601. */
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
 * Walks the swap that moves the approval signer onto this phone.
 *
 * Only S1 signs here, and that is the whole point: the phone holding S2 is
 * gone, so the pair meeting the threshold is S1 on this device and S3 in the
 * vault. The backend produces S3's approval itself, which is what the emailed
 * code bought, and it never reaches this loop.
 */
export async function runDeviceRotation(
  primarySigner: string,
  provider: SolanaProvider,
  grantId?: string
): Promise<DeviceRotationOutcome> {
  let steps = 0;

  for (;;) {
    const plan: DeviceRotationStep =
      await apiClient.nextDeviceRotationStep(grantId);
    if (plan.done) return { waitingUntil: null, finished: true };

    if (plan.step === "waiting") {
      return { waitingUntil: plan.executableAt ?? null, finished: false };
    }

    if (!plan.unsignedTxBase64) {
      throw new Error(`Rotation step ${plan.step} carried no transaction`);
    }
    if (++steps > MAX_STEPS) {
      throw new Error(
        `Rotation did not finish in ${MAX_STEPS} steps; stuck on ${plan.step}`
      );
    }

    const tx = VersionedTransaction.deserialize(
      toByteArray(plan.unsignedTxBase64)
    );

    // Only when S1 actually has a slot: the fee payer is the settlement
    // authority, and handing Privy a transaction its key does not appear in
    // fails the step outright.
    const signed = requiresPrimary(tx, primarySigner)
      ? (
          await provider.request({
            method: "signTransaction",
            params: { transaction: tx },
          })
        ).signedTransaction
      : tx;

    await apiClient.submitDeviceRotationStep({
      signedTxBase64: fromByteArray(signed.serialize()),
    });
  }
}

function invalidateAfterRotation(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: PENDING_CHANGE_KEY });
}

/**
 * Starts the swap: a fresh hardware key on this phone, attested, then the
 * steps this device can sign.
 *
 * The key is generated here and proved to the backend the same way enrolment
 * does it, because this one joins the signer set of an Account that already
 * holds money. A key taken on trust would let a caller rotate something it
 * controls in software into the place S2 is supposed to occupy.
 */
export function useDeviceRotation() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { data: account } = useAccount();
  const { recordStarted } = useInitiatedChanges();

  return useMutation({
    mutationFn: async (grantId: string): Promise<DeviceRotationOutcome> => {
      const wallet = embeddedSolana.wallets?.[0];
      if (!wallet) throw new Error("Wallet not ready");
      if (!account) throw new Error("Account not loaded");

      // A key already here belongs to an attempt that got as far as attesting.
      // Attesting again would mint a second one and strand the sub-organization
      // the backend built around the first.
      const existing = await hardwareKey.getPublicKey();
      if (existing) {
        try {
          const staged = await apiClient.startDeviceRotation({
            grantId,
            hardwarePublicKey: existing,
          });
          // Written down before a step is signed. The alarm is driven off the
          // chain, and a change staged without this recorded would go off on
          // the phone that staged it.
          if (staged.changeIndex) recordStarted(staged.changeIndex);
          return runDeviceRotation(
            account.signers.primary,
            (await wallet.getProvider()) as SolanaProvider,
            grantId
          );
        } catch (err) {
          if (__DEV__) {
            console.warn("[rotation] could not resume with the local key", err);
          }
        }
      }

      const { nonce } = await apiClient.requestEnrolmentNonce();

      let attestation: string;
      let publicKey: string;
      try {
        ({ attestation, publicKey } = await hardwareKey.enrol(nonce));
      } catch (err) {
        await hardwareKey.reset().catch(() => {});
        throw err;
      }

      const staged = await apiClient.startDeviceRotation({
        grantId,
        platform: devicePlatform(),
        attestation,
        nonce,
        hardwarePublicKey: publicKey,
      });
      if (staged.changeIndex) recordStarted(staged.changeIndex);

      return runDeviceRotation(
        account.signers.primary,
        (await wallet.getProvider()) as SolanaProvider,
        grantId
      );
    },
    // Settled rather than success: a run that failed part way has still moved,
    // and the screen has to show where it actually got to.
    onSettled: () => invalidateAfterRotation(queryClient),
  });
}

/**
 * Lands a swap whose security delay has run out.
 *
 * A query for the same reasons as the recovery-key equivalent: "once, only when
 * these hold, without racing itself" is what a key plus `enabled` already say.
 * The execute step needs no grant, because the code was spent on S3's approval
 * a day earlier and this step is signed by the phone alone.
 */
export function useFinishDeviceRotation() {
  const queryClient = useQueryClient();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const { data: account } = useAccount();

  const wallet = embeddedSolana.wallets?.[0];
  const pending = account?.pendingApprovalSigner ?? null;

  return useQuery({
    queryKey: ["device-rotation", "finish", pending ?? "none"],
    queryFn: async () => {
      const outcome = await runDeviceRotation(
        account!.signers.primary,
        (await wallet!.getProvider()) as SolanaProvider
      );
      invalidateAfterRotation(queryClient);
      return outcome;
    },
    enabled: !!account && !!wallet && !!pending,
    // Whether the delay is over is the server's call, read off the chain. A
    // phone with a skewed clock must not be what decides that.
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
  });
}

function requiresPrimary(tx: VersionedTransaction, primary: string): boolean {
  return tx.message.staticAccountKeys
    .slice(0, tx.message.header.numRequiredSignatures)
    .some((key) => key.toBase58() === primary);
}
