import { useCallback, useRef } from 'react';
import {
  useLoginWithPasskey,
  useIdentityToken,
  usePrivy,
} from '@privy-io/react-auth';
import { useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { checkoutChain } from '../lib/solana';

export interface CeremonyResult {
  /** The provider IDENTITY token, passed to authorize as providerToken. */
  providerToken: string;
}

/*
 * @privy-io/expo's linkWithPasskey takes relyingParty per call. The web SDK
 * uses the rp.id returned by Privy's authentication-options endpoint. The
 * installed SDK does not accept a relyingParty override. A live local probe
 * on www.xend.global returned rp.id=www.xend.global, whereas mobile signup
 * explicitly uses https://xend.global. Serve Checkout on the enrollment
 * domain and verify the returned rp.id; an extra ignored option cannot pin it.
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
    if (!authedRef.current) await loginWithPasskey();
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
      executionCluster: string,
    ): Promise<string> => {
      const chain = checkoutChain(executionCluster);
      if (!authedRef.current) {
        // A Session says the Consumer is recognised, not that a signer is
        // available. If the provider session has lapsed the passkey has to be
        // presented again before anything can be signed.
        await loginWithPasskey();
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
        chain,
        // Xend's purchase confirmation is the consent surface. This only hides
        // the redundant vendor transaction sheet, not passkey authentication.
        options: { uiOptions: { showWalletUIs: false } },
      });
      return toBase64(signedTransaction);
    },
    [loginWithPasskey, signTransaction],
  );

  return { runCeremony, signSpend };
}
