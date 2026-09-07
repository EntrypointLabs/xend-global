import { useRef, useState } from "react";
import { Platform } from "react-native";
import {
  useLoginWithPasskey,
  useSignupWithPasskey,
} from "@privy-io/expo/passkey";
import { useIdentityToken, usePrivy } from "@privy-io/expo";

import { useAuth } from "@/contexts/AuthContext";
import {
  classifyPasskeyError,
  PasskeyHasNoAccountError,
  PasskeyWrongAccountError,
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
  /** A ref, because the caller reads it right after an await resolves. */
  const wrongAccount = useRef<string | null>(null);

  const { loginWithPasskey } = useLoginWithPasskey();
  const { signupWithPasskey } = useSignupWithPasskey();
  const { user: privyUser, logout: privyLogout } = usePrivy();
  const { getIdentityToken } = useIdentityToken();

  /**
   * Privy authenticating is only half of it. The app's own session comes from
   * exchanging the identity token for a Xend JWT, which is the same step every
   * other sign-in takes; without it the Consumer is signed in to Privy and to
   * nothing else.
   */
  const run = async (
    authenticate: () => Promise<{ id?: string } | undefined | null>,
    noUser: string,
    signupToken?: string,
    expectUserId?: string
  ): Promise<PasskeySignInOutcome> => {
    setError(null);
    setBusy(true);
    try {
      // Privy refuses to authenticate while a session is already open, and one
      // can outlive the app's own: a sign-in that authenticated but failed to
      // exchange leaves Privy logged in and Xend logged out.
      if (privyUser) await privyLogout();

      // The provider intermittently answers its first ceremony call with an
      // empty body, which surfaces as a JSON parse error before any
      // credential exists. One clean retry absorbs it; a second failure is
      // reported rather than looped.
      let user: Awaited<ReturnType<typeof authenticate>>;
      try {
        user = await authenticate();
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        console.log("[passkey] empty ceremony response; retrying once");
        user = await authenticate();
      }
      if (!user) {
        setError(noUser);
        return "failed";
      }
      if (await completePasskeySession(user, signupToken, expectUserId)) {
        return "signed-in";
      }

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
      // The wrong credential for the account the inbox named. Privy's
      // half-open session is for the other account, so it is closed before
      // the retry, and the refusal happened before the session changed owner.
      if (err instanceof PasskeyWrongAccountError) {
        wrongAccount.current = err.maskedEmail;
        await privyLogout().catch(() => undefined);
        console.log("[passkey] sign-in ended as wrong-account");
        return "wrong-account";
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

  const signIn = (expectUserId?: string) =>
    run(
      () => loginWithPasskey({ relyingParty: RELYING_PARTY }),
      "That passkey did not sign you in.",
      undefined,
      expectUserId
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

  /**
   * Creates a brand new credential and hands back its identity token, without
   * an exchange: the token names the incoming signer for a passkey
   * replacement, and the binding that makes it open the Account moves only
   * when that change executes a day later.
   */
  const createReplacement = async (): Promise<string | null> => {
    setError(null);
    setBusy(true);
    try {
      if (privyUser) await privyLogout();
      const created = (await signupWithPasskey({ relyingParty: RELYING_PARTY }))
        .user;
      if (!created) {
        setError("The passkey was not created.");
        return null;
      }
      const idToken = await getIdentityToken();
      if (!idToken) {
        setError("The new passkey could not be verified.");
        return null;
      }
      return idToken;
    } catch (err) {
      const outcome = classifyPasskeyError(err, Platform.OS);
      if (outcome === "failed") {
        setError(describe(err));
        console.error("[passkey] replacement failed", err);
      } else {
        console.log(`[passkey] replacement ended as ${outcome}`);
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Closes the fresh credential's session once its token has been handed over. */
  const discardPrivySession = () => privyLogout().catch(() => undefined);

  return {
    signIn,
    signUp,
    createReplacement,
    discardPrivySession,
    busy,
    error,
    clearError: () => setError(null),
    /** Masked address of the account the last wrong pick opened, when named. */
    wrongAccountEmail: () => wrongAccount.current,
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
