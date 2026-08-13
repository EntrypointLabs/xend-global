import { useEffect, useRef } from "react";
import * as Sentry from "@sentry/react-native";

import { useAccount } from "@/hooks/useAccount";
import { useEnrolAccount } from "@/hooks/useEnrolAccount";
import { useSweepToVault } from "@/hooks/useSweepToVault";

/**
 * Makes sure a signed-in Consumer has an Account, then moves anything left in
 * the Privy wallet across.
 *
 * Runs once per app session rather than on every render of every screen. Both
 * steps are individually idempotent, but enrolment prompts for biometrics and
 * re-prompting a Consumer who is already enrolled reads as something being
 * wrong.
 *
 * A failure is deliberately silent to the Consumer. They can still receive at
 * the Privy address and still spend from it, so a failed enrolment is a
 * degraded session rather than a broken one, and blocking the app on it would
 * be worse than the thing it is protecting against.
 *
 * Silent to the Consumer is not silent to us. Swallowing the error outright
 * left the only evidence of a failed enrolment in the Turnkey dashboard, which
 * cannot distinguish "attestation was rejected" from "the request never
 * arrived". Which step threw is the whole diagnosis, so it is reported.
 */
export function useEnsureAccount() {
  const { data: account, isLoading } = useAccount();
  const enrol = useEnrolAccount();
  const sweep = useSweepToVault();
  const attempted = useRef(false);

  useEffect(() => {
    if (isLoading || attempted.current) return;

    attempted.current = true;

    const run = async () => {
      if (!account) {
        try {
          await enrol.mutateAsync();
        } catch (err) {
          report("enrol", err);
          throw err;
        }
      }
      try {
        await sweep.mutateAsync();
      } catch (err) {
        report("sweep", err);
        throw err;
      }
    };

    run().catch(() => {
      // Already reported with the failing step attached. Retried on the next
      // app start rather than in a loop here: enrolment costs a biometric
      // prompt and an on-chain account.
    });
  }, [account, isLoading, enrol, sweep]);

  return {
    account,
    isEnrolling: enrol.isPending,
    isSweeping: sweep.isPending,
  };
}

/**
 * The backend's typed code (ATTESTATION_REJECTED, NONCE_*, ...) is the useful
 * part and it lives on the response body, not the message, so it is pulled up
 * where a Sentry search can reach it. The dev console gets it too: the failure
 * is invisible in the UI by design, so Metro is where it gets noticed.
 */
function report(step: "enrol" | "sweep", err: unknown) {
  const code = (err as { data?: { code?: string } })?.data?.code;

  if (__DEV__) {
    console.warn(`[account] ${step} failed`, code ?? "", err);
  }

  Sentry.captureException(err, {
    tags: { accountStep: step, ...(code ? { failureCode: code } : {}) },
  });
}
