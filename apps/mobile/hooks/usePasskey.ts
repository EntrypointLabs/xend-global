import { useState } from "react";
import { usePrivy } from "@privy-io/expo";
import { useLinkWithPasskey } from "@privy-io/expo/passkey";

import { AuthStorage } from "@/utils/storage/authStorage";

// Privy validates this as a full origin URL and derives the WebAuthn rp.id
// from its registrable domain (the apex `xend.global`, not the www host). So
// `xend.global/.well-known/assetlinks.json` must serve directly (200, no
// redirect) — Digital Asset Links refuses to follow the apex→www redirect.
const RELYING_PARTY = "https://xend.global";

/**
 * Passkey enrollment backed by Privy. A passkey is linked to the already
 * authenticated user (post email-OTP) and appears on `user.linked_accounts`.
 * The `_accountAddress` args are ignored — kept so existing callers compile.
 */
export function usePasskey() {
  const { user } = usePrivy();
  const [error, setError] = useState<string | null>(null);

  const hasPasskey =
    user?.linked_accounts.some((account) => account.type === "passkey") ??
    false;

  const { linkWithPasskey, state } = useLinkWithPasskey({
    onError: (err) => setError(err?.message ?? "Passkey setup failed"),
  });

  const isRegistering =
    state.status !== "initial" &&
    state.status !== "done" &&
    state.status !== "error";

  const checkPasskeys = async (_accountAddress?: string): Promise<boolean> =>
    hasPasskey;

  const registerPasskey = async (
    _accountAddress?: string
  ): Promise<boolean> => {
    setError(null);
    try {
      const updated = await linkWithPasskey({ relyingParty: RELYING_PARTY });
      const linked =
        updated?.linked_accounts.some(
          (account) => account.type === "passkey"
        ) ?? false;
      // Persist so the biometric app lock arms on the next launch even before
      // Privy's user has rehydrated.
      if (linked) {
        await AuthStorage.saveHasPasskey(true);
      }
      return linked;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey setup failed");
      return false;
    }
  };

  const clearError = () => setError(null);

  return {
    hasPasskey,
    isChecking: false,
    isRegistering,
    error,
    checkPasskeys,
    registerPasskey,
    clearError,
  };
}
