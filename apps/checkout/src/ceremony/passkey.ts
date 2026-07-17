import { useCallback, useRef } from 'react';
import {
  useLoginWithPasskey,
  useSignupWithPasskey,
  useIdentityToken,
  usePrivy,
} from '@privy-io/react-auth';
import { RP_ORIGIN } from '../lib/config';

export interface CeremonyResult {
  /** The provider IDENTITY token, passed to authorize as providerToken. */
  providerToken: string;
}

/*
 * @privy-io/expo's linkWithPasskey takes relyingParty per call. The web SDK
 * (@privy-io/react-auth 3.34) derives rp.id from the Privy app's allowed-domains
 * configuration instead (rp.id = xend.global via the apex AASA/DAL, see
 * docs/specs/privy-config-verification.md). We still pin the intended relying
 * party explicitly here so REQ-RPID is visible in code and never silently
 * defaults to the popup origin, and forward it to the SDK for when the web SDK
 * exposes it per call.
 */
const CEREMONY_LOGIN_OPTIONS: {
  relyingParty: string;
  credentialIds?: string[];
} = {
  relyingParty: RP_ORIGIN,
};

/**
 * The single vendor seam. All Privy web SDK usage lives on this code-split
 * ceremony path and nowhere else in the app. The backend verifies the Privy
 * IDENTITY token (client.getUser({ idToken })), so we hand it that, not the
 * access token. The identity token lands in state a beat after login resolves,
 * so we poll a ref for it. (Requires "identity tokens" enabled on the Privy app.)
 */
export function usePasskeyCeremony() {
  const { authenticated } = usePrivy();
  const { loginWithPasskey } = useLoginWithPasskey();
  const { signupWithPasskey } = useSignupWithPasskey();
  const { identityToken } = useIdentityToken();
  const tokenRef = useRef<string | null>(identityToken);
  const authedRef = useRef<boolean>(authenticated);
  tokenRef.current = identityToken;
  authedRef.current = authenticated;

  const awaitIdentityToken = useCallback(async (): Promise<string> => {
    for (let i = 0; i < 40; i++) {
      if (tokenRef.current) return tokenRef.current;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('No identity token after the passkey ceremony');
  }, []);

  const runCeremony = useCallback(async (): Promise<CeremonyResult> => {
    // Already authenticated (persisted Privy session) -> reuse the token, no
    // prompt. Otherwise loginWithPasskey runs first (no awaited fetch before it,
    // so Safari user activation stays valid).
    if (!authedRef.current) await loginWithPasskey(CEREMONY_LOGIN_OPTIONS);
    return { providerToken: await awaitIdentityToken() };
  }, [loginWithPasskey, awaitIdentityToken]);

  // First-time consumer: enrol a new passkey (rp.id from Privy config), then
  // the same identity-token handoff as the login path.
  const runSignup = useCallback(async (): Promise<CeremonyResult> => {
    if (!authedRef.current) await signupWithPasskey();
    return { providerToken: await awaitIdentityToken() };
  }, [signupWithPasskey, awaitIdentityToken]);

  return { runCeremony, runSignup };
}
