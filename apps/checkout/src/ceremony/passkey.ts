import { useCallback } from 'react';
import { useLoginWithPasskey, usePrivy } from '@privy-io/react-auth';
import { RP_ORIGIN } from '../lib/config';

export interface CeremonyResult {
  /** The provider identity token, passed to authorize as providerToken. */
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
 * ceremony path and nowhere else in the app.
 */
export function usePasskeyCeremony() {
  const { loginWithPasskey } = useLoginWithPasskey();
  const { getAccessToken } = usePrivy();

  const runCeremony = useCallback(async (): Promise<CeremonyResult> => {
    // Invoked first thing inside the click handler with no awaited fetch before
    // it, so Safari user activation stays valid.
    await loginWithPasskey(CEREMONY_LOGIN_OPTIONS);
    const providerToken = await getAccessToken();
    if (!providerToken) {
      throw new Error('No provider token after the passkey ceremony');
    }
    return { providerToken };
  }, [loginWithPasskey, getAccessToken]);

  return { runCeremony };
}
