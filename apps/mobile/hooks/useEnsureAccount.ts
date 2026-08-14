import { useEffect, useRef } from "react";
import * as Sentry from "@sentry/react-native";

import { useAccount } from "@/hooks/useAccount";
import { useProvisionAccount } from "@/hooks/useProvisionAccount";
import { apiClient } from "@/utils/apiClient";
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
  const { data: account, isSuccess } = useAccount();
  const enrol = useEnrolAccount();
  const provision = useProvisionAccount();
  const sweep = useSweepToVault();
  const attempted = useRef(false);

  useEffect(() => {
    // Gated on isSuccess, not on !isLoading. The account query is disabled
    // until a Consumer is signed in, and a disabled react-query reports
    // isLoading false with undefined data -- indistinguishable from "fetched,
    // no Account". Acting on that fired enrolment before there was a token to
    // send, and because the guard below is once per session, the 401 it earned
    // then blocked the real attempt for the rest of the session.
    //
    // isSuccess is only true once the query resolved, and getAccount maps the
    // pre-enrolment 404 to null, so null here means a confirmed absence rather
    // than an unknown.
    if (!isSuccess || attempted.current) return;

    attempted.current = true;

    const run = async () => {
      let current = account;

      if (current === null) {
        try {
          await enrol.mutateAsync();
        } catch (err) {
          report("enrol", err);
          throw err;
        }
        // Re-read rather than use the enrolment response, which carries only
        // the address. Provisioning needs the sub-organization id and the
        // approval signer to ask Turnkey for S2's signature.
        current = await apiClient.getAccount();
      }

      if (current) {
        try {
          await provision.mutateAsync(current);
        } catch (err) {
          report("provision", err);
          throw err;
        }
      }

      // After provisioning, not before. The sweep is what puts money in the
      // vault, and until both policies exist there is no route that can spend
      // it back out.
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
  }, [account, isSuccess, enrol, provision, sweep]);

  return {
    account,
    isEnrolling: enrol.isPending,
    isProvisioning: provision.isPending,
    isSweeping: sweep.isPending,
  };
}

/**
 * The backend's typed code (ATTESTATION_REJECTED, NONCE_*, ...) is the useful
 * part and it lives on the response body, not the message, so it is pulled up
 * where a Sentry search can reach it. The dev console gets it too: the failure
 * is invisible in the UI by design, so Metro is where it gets noticed.
 */
function report(step: "enrol" | "provision" | "sweep", err: unknown) {
  const code = (err as { data?: { code?: string } })?.data?.code;

  if (__DEV__) {
    console.warn(`[account] ${step} failed`, code ?? "", err);
  }

  Sentry.captureException(err, {
    tags: { accountStep: step, ...(code ? { failureCode: code } : {}) },
  });
}
