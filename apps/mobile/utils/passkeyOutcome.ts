/**
 * What became of an attempt to sign in with a passkey.
 *
 * `no-passkey` is the interesting one. It does not mean the Consumer is new:
 * passkeys do not cross ecosystems, so an iPhone account signing in on Android
 * looks exactly like a first-time visitor. Creating an account on that signal
 * alone would hand them a second, empty wallet and strand the first, so the
 * caller has to ask rather than assume.
 */
export type PasskeySignInOutcome =
  | "signed-in"
  | "no-passkey"
  | "no-account"
  | "cancelled"
  | "failed";

/**
 * The passkey worked and Xend has no account behind it.
 *
 * Every account starts from a proved address, so the only way forward is the
 * email door. Raised through the sign-in path rather than reported as a
 * failure, because the Consumer did nothing wrong and the next step is
 * specific.
 */
export class PasskeyHasNoAccountError extends Error {
  constructor() {
    super("This passkey is not on a Xend account yet");
    this.name = "PasskeyHasNoAccountError";
  }
}

/**
 * Reads the platform's own verdict off a rejected passkey request.
 *
 * Android answers precisely: `NoCredentials` when it has nothing to offer,
 * `UserCancelled` when the Consumer dismissed the sheet. iOS collapses both
 * into ASAuthorizationError 1001, because it errors the same way whether it
 * showed a sheet or never had one to show. Reading that as `no-passkey` costs
 * a Consumer who cancelled one dismissible screen; reading it as `cancelled`
 * would dead-end every new iPhone owner on a button that appears to do
 * nothing.
 */
export function classifyPasskeyError(
  err: unknown,
  platform: string
): Exclude<PasskeySignInOutcome, "signed-in" | "no-account"> {
  const text = `${(err as { code?: string })?.code ?? ""} ${
    err instanceof Error ? err.message : String(err ?? "")
  }`;

  if (/NoCredential/i.test(text)) return "no-passkey";
  if (/UserCancell?ed|USER_CANCELED|cancell?ed/i.test(text)) {
    return platform === "ios" ? "no-passkey" : "cancelled";
  }
  return "failed";
}
