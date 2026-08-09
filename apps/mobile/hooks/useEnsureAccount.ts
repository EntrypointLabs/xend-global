import { useEffect, useRef } from "react";

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
 * A failure is deliberately silent. The Consumer can still receive at the Privy
 * address and still spend from it, so a failed enrolment is a degraded session
 * rather than a broken one, and blocking the app on it would be worse than the
 * thing it is protecting against.
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
      if (!account) await enrol.mutateAsync();
      await sweep.mutateAsync();
    };

    run().catch(() => {
      // Retried on the next app start rather than in a loop here: enrolment
      // costs a biometric prompt and an on-chain account.
    });
  }, [account, isLoading, enrol, sweep]);

  return {
    account,
    isEnrolling: enrol.isPending,
    isSweeping: sweep.isPending,
  };
}
