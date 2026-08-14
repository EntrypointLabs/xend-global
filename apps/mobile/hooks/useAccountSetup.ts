import { useCallback, useState } from "react";
import * as Sentry from "@sentry/react-native";

import { useAccount } from "@/hooks/useAccount";
import { useEnrolAccount } from "@/hooks/useEnrolAccount";
import { useProvisionAccount } from "@/hooks/useProvisionAccount";
import { useSweepToVault } from "@/hooks/useSweepToVault";
import { apiClient } from "@/utils/apiClient";

/** What the Consumer is being shown while it happens. */
export type AccountSetupStage =
  | "idle"
  | "creating"
  | "spending-limit"
  | "above-limit"
  | "time-lock";

/**
 * Creates the Consumer's wallet and makes it spendable, on demand.
 *
 * Driven by a button rather than by mounting. Every step needs a signature
 * from the phone -- securing the wallet means changing its on-chain settings,
 * and those need two of its three signers, of which the phone holds two. So
 * fingerprint prompts are unavoidable; what is avoidable is them arriving
 * unannounced, which is what running this from a screen effect produced.
 *
 * The sweep goes last. It is what moves money into the vault, and until both
 * policies exist there is no route that can spend it back out.
 */
export function useAccountSetup() {
  const { data: account } = useAccount();
  const [stage, setStage] = useState<AccountSetupStage>("idle");
  const [error, setError] = useState<string | null>(null);

  const enrol = useEnrolAccount();
  const provision = useProvisionAccount((change) => setStage(change ?? "idle"));
  const sweep = useSweepToVault();

  const run = useCallback(async () => {
    setError(null);
    try {
      let current = account ?? null;

      if (current === null) {
        setStage("creating");
        await enrol.mutateAsync();
        // Re-read rather than use the enrolment response, which carries only
        // the address. Provisioning needs the sub-organization id and the
        // approval signer to ask Turnkey for S2's signature.
        current = await apiClient.getAccount();
      }

      if (current) await provision.mutateAsync(current);
      await sweep.mutateAsync();

      setStage("idle");
      return true;
    } catch (err) {
      report(err);
      setStage("idle");
      setError(
        "We could not finish securing your wallet. You can try again, or carry on and we will pick this up next time."
      );
      return false;
    }
  }, [account, enrol, provision, sweep]);

  return { stage, error, run, clearError: () => setError(null) };
}

/**
 * The Consumer sees one sentence; this is where the cause goes. The backend's
 * typed code lives on the response body rather than the message, so it is
 * lifted onto a tag a Sentry search can reach, and printed in dev because the
 * modal deliberately does not show it.
 */
function report(err: unknown) {
  const code = (err as { data?: { code?: string } })?.data?.code;

  if (__DEV__) {
    console.warn("[account] setup failed", code ?? "", err);
  }

  Sentry.captureException(err, {
    tags: { accountStep: "setup", ...(code ? { failureCode: code } : {}) },
  });
}
