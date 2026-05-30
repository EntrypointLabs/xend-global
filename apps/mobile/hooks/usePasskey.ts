import { useState } from "react";

/**
 * Privy enrols the passkey IN-APP during signup (`useLoginWithEmail` →
 * `loginWithCode` provisions the embedded wallet with passkey-backed
 * recovery). With the legacy Grid-shaped `/passkeys/check` and
 * `/passkeys/session` routes deleted in Phase 5, this hook is a no-op stub
 * kept so its callers (`(auth)/email-login.tsx`, `(tabs)/settings/index.tsx`)
 * continue to compile without screen-level rewires.
 *
 * Both methods synchronously return `true` so the post-OTP passkey-check
 * branch in `email-login.tsx` (`hasExisting ? complete() : showSetupModal()`)
 * skips the setup modal entirely.
 */
export function usePasskey() {
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(true);
  const [isChecking] = useState(false);
  const [isRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const checkPasskeys = async (_accountAddress: string): Promise<boolean> => {
    setHasPasskey(true);
    return true;
  };

  const registerPasskey = async (_accountAddress: string): Promise<boolean> => {
    setHasPasskey(true);
    return true;
  };

  return {
    hasPasskey,
    isChecking,
    isRegistering,
    error,
    checkPasskeys,
    registerPasskey,
    clearError,
  };
}
