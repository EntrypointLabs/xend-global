import { useState } from "react";
import { usePrivy } from "@privy-io/expo";
import { useLinkWithPasskey } from "@privy-io/expo/passkey";

import { hasLinkedPasskey } from "@/utils/auth";
import { apiClient } from "@/utils/apiClient";

/** Raw passkey entry on Privy's `linked_accounts` (snake_case REST shape). */
type RawPasskeyAccount = {
  type: string;
  credential_id?: string;
  public_key?: string;
};

/**
 * Mirror freshly enrolled passkey credentials to the backend as a vendor
 * hedge. Fire-and-forget: never awaited, never throws, and never surfaces
 * to the enrollment result. The server also mirrors the credential ID on
 * every /auth/exchange; this path additionally backfills the public key,
 * which the server-side vendor SDK cannot see.
 */
function mirrorEnrolledPasskeys(updated: { linked_accounts?: unknown } | null) {
  const accounts =
    (updated?.linked_accounts as RawPasskeyAccount[] | undefined) ?? [];
  for (const account of accounts) {
    if (account.type !== "passkey" || !account.credential_id) continue;
    apiClient
      .mirrorPasskeyCredential({
        credentialId: account.credential_id,
        publicKey: account.public_key,
      })
      .catch((err) => {
        console.warn("passkey credential mirror failed (non-fatal)", err);
      });
  }
}

// Privy validates this as a full origin URL and derives the WebAuthn rp.id
// from its registrable domain (the apex `xend.global`, not the www host). So
// `xend.global/.well-known/assetlinks.json` must serve directly (200, no
// redirect) — Digital Asset Links refuses to follow the apex→www redirect.
const RELYING_PARTY = "https://xend.global";

/**
 * Passkey enrollment backed by Privy. A passkey is linked to the already
 * authenticated user (post email-OTP) and appears on `user.linked_accounts`.
 */
export function usePasskey() {
  const { user } = usePrivy();
  const [error, setError] = useState<string | null>(null);

  const hasPasskey = hasLinkedPasskey(user);

  const { linkWithPasskey, state } = useLinkWithPasskey({
    onError: (err) => setError(err?.message ?? "Passkey setup failed"),
  });

  const isRegistering =
    state.status !== "initial" &&
    state.status !== "done" &&
    state.status !== "error";

  const registerPasskey = async (): Promise<boolean> => {
    setError(null);
    try {
      const updated = await linkWithPasskey({ relyingParty: RELYING_PARTY });
      mirrorEnrolledPasskeys(updated ?? null);
      return hasLinkedPasskey(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey setup failed");
      return false;
    }
  };

  const clearError = () => setError(null);

  return {
    hasPasskey,
    isRegistering,
    error,
    registerPasskey,
    clearError,
  };
}
