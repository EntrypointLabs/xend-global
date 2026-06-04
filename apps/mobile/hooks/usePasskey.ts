import { useState } from "react";

/**
 * No-op passkey hook. Privy enrols the passkey in-app during signup, so a
 * separate check/register step is unnecessary. Both methods return `true` so
 * the post-OTP branch in `email-login.tsx` skips the setup modal entirely.
 * Kept so its callers compile without screen-level rewires.
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
