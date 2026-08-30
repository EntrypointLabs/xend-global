import { useState } from "react";
import { Platform } from "react-native";
import {
  useLoginWithPasskey,
  useSignupWithPasskey,
} from "@privy-io/expo/passkey";
import { usePrivy } from "@privy-io/expo";

import { useAuth } from "@/contexts/AuthContext";
import {
  classifyPasskeyError,
  PasskeyHasNoAccountError,
  type PasskeySignInOutcome,
} from "@/utils/passkeyOutcome";

/** Must match the relying party the credential was registered against. */
const RELYING_PARTY = "https://xend.global";

/**
 * Signs in with a passkey alone. No email, no code.
 *
 * This is the premise the whole signer model rests on. D4 says the passkey
 * unlocks S1 and email unlocks nothing else, which is what makes it safe for
 * S3 to share the sign-up address.
 *
 * The failure worth recognising: Privy sends `allow_credentials: null`, so the
 * platform offers every credential it holds for the relying party. Attempts
 * that failed before the signing certificate was allowlisted left orphans
 * behind, and picking one of those fails with `invalid_credentials` even
 * though passkey sign-in itself is working.
 */
export function usePasskeyLogin() {
  const { completePasskeySession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { loginWithPasskey } = useLoginWithPasskey();
  const { signupWithPasskey } = useSignupWithPasskey();
  const { user: privyUser, logout: privyLogout } = usePrivy();

  /**
   * Privy authenticating is only half of it. The app's own session comes from
   * exchanging the identity token for a Xend JWT, which is the same step every
   * other sign-in takes; without it the Consumer is signed in to Privy and to
   * nothing else.
   */
  const run = async (
    authenticate: () => Promise<{ id?: string } | undefined | null>,
    noUser: string,
    signupToken?: string
  ): Promise<PasskeySignInOutcome> => {
    setError(null);
    setBusy(true);
    try {
      // Privy refuses to authenticate while a session is already open, and one
      // can outlive the app's own: a sign-in that authenticated but failed to
      // exchange leaves Privy logged in and Xend logged out.
      if (privyUser) await privyLogout();

      const user = await authenticate();
      if (!user) {
        setError(noUser);
        return "failed";
      }
      if (await completePasskeySession(user, signupToken)) return "signed-in";

      setError("Signed in, but Xend could not start your session.");
      return "failed";
    } catch (err) {
      // The passkey is real and Xend has nothing behind it. Not a failure to
      // show in red: the answer is the email door, and Privy's half-open
      // session is closed so the next attempt starts clean.
      if (err instanceof PasskeyHasNoAccountError) {
        await privyLogout().catch(() => undefined);
        console.log("[passkey] sign-in ended as no-account");
        return "no-account";
      }
      const outcome = classifyPasskeyError(err, Platform.OS);
      // Both of the other outcomes are answered with a screen rather than a
      // line of red text, and a dismissed sheet is not a failure at all.
      if (outcome === "failed") {
        setError(describe(err));
        console.error("[passkey] sign-in failed", err);
      } else {
        // Deliberately not an error. An empty keychain and a dismissed sheet
        // are both things the flow expects and answers, and logging them at
        // error level buries the ones that are actually wrong.
        console.log(`[passkey] sign-in ended as ${outcome}`);
      }
      return outcome;
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    run(
      () => loginWithPasskey({ relyingParty: RELYING_PARTY }),
      "That passkey did not sign you in."
    );

  /**
   * Creates a brand new account. Never signs in to an existing one.
   *
   * The token comes from the email step and is what the exchange uses to put
   * this passkey on the row whose address was just proved.
   */
  const signUp = async (signupToken: string) =>
    (await run(
      async () =>
        (await signupWithPasskey({ relyingParty: RELYING_PARTY })).user,
      "The passkey was not created.",
      signupToken
    )) === "signed-in";

  return {
    signIn,
    signUp,
    busy,
    error,
    clearError: () => setError(null),
  };
}

function describe(err: unknown): string {
  // Privy answering 200 with an empty body surfaces here as a JSON parse
  // error, which says nothing to a Consumer and points at the wrong layer for
  // whoever reads the report. The real error still goes to the console.
  if (err instanceof SyntaxError) {
    return "Xend could not read the response from our sign-in provider.";
  }
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Passkey sign-in failed.";
}
