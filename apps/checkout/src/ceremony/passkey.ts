import { useCallback, useRef } from 'react';
import {
  useLoginWithPasskey,
  useIdentityToken,
  usePrivy,
} from '@privy-io/react-auth';
import { useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
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
/*
 * The wire carries transactions as base64 and the Privy Solana SDK takes and
 * returns raw bytes, so the popup converts at this boundary and nowhere else.
 */
function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

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
  const { identityToken } = useIdentityToken();
  const { signTransaction } = useSignTransaction();
  const { wallets } = useWallets();
  const tokenRef = useRef<string | null>(identityToken);
  const authedRef = useRef<boolean>(authenticated);
  const walletsRef = useRef(wallets);
  tokenRef.current = identityToken;
  authedRef.current = authenticated;
  walletsRef.current = wallets;

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
    // so Safari user activation stays valid). The checkout only AUTHENTICATES an
    // existing consumer; identity (email + passkey + wallet) is created once in
    // the mobile app, never here.
    if (!authedRef.current) await loginWithPasskey(CEREMONY_LOGIN_OPTIONS);
    return { providerToken: await awaitIdentityToken() };
  }, [loginWithPasskey, awaitIdentityToken]);

  /**
   * Signs the Spend the backend built, with the Account's primary signer.
   *
   * This is the half people conflate with the passkey. A WebAuthn credential
   * signs a WebAuthn assertion, not an ed25519 Solana transaction, so the
   * passkey proves who the Consumer is and the embedded wallet it unlocks is
   * what actually moves the money. One prompt, two different things.
   *
   * The transaction comes back one signature short: the settlement authority is
   * the fee payer and completes it server-side, because a Consumer holding only
   * dollars has no lamports to pay with.
   */
  const signSpend = useCallback(
    async (
      unsignedTxBase64: string,
      signerAddress: string,
    ): Promise<string> => {
      if (!authedRef.current) {
        // A Session says the Consumer is recognised, not that a signer is
        // available. If the provider session has lapsed the passkey has to be
        // presented again before anything can be signed.
        await loginWithPasskey(CEREMONY_LOGIN_OPTIONS);
      }
      // The backend names the key it compiled the Spend for. Picking by address
      // rather than taking the first connected wallet: signing with a key the
      // Account does not know produces a transaction the program refuses.
      const wallet = walletsRef.current.find(
        (w) => w.address === signerAddress,
      );
      if (!wallet) {
        throw new Error(`no connected wallet for signer ${signerAddress}`);
      }
      const { signedTransaction } = await signTransaction({
        transaction: fromBase64(unsignedTxBase64),
        wallet,
      });
      return toBase64(signedTransaction);
    },
    [loginWithPasskey, signTransaction],
  );

  return { runCeremony, signSpend };
}
