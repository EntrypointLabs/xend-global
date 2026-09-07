import { z } from 'zod';

/**
 * /auth/exchange request — a Privy ID token issued to the mobile app
 * after the user completes the Privy email-OTP + embedded-wallet flow.
 * The backend verifies the token, upserts the user + smart_account, and
 * returns our own JWT for subsequent API calls.
 */
export const ExchangeRequestSchema = z.object({
  privyIdToken: z.string().min(1),
  /**
   * Present on the exchange that follows sign-up. It binds the Privy user to
   * the users row whose address was proved a moment earlier; without it the
   * exchange can only reach a row this Privy user is already bound to.
   */
  signupToken: z.string().min(1).optional(),
  /**
   * Present when the sign-in follows a proved inbox, and it pins the result:
   * the exchange must land on this user or refuse. Without it, a device
   * holding passkeys for two accounts can answer a code for one with the
   * credential of the other, and the session silently changes owner.
   */
  expectUserId: z.string().min(1).optional(),
});
export type ExchangeRequest = z.infer<typeof ExchangeRequestSchema>;

export const ExchangeResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    // Null until the Consumer gives one: the passkey is the credential.
    email: z.string().email().nullable(),
    walletAddress: z.string(),
    isNewUser: z.boolean(),
  }),
});
export type ExchangeResponse = z.infer<typeof ExchangeResponseSchema>;

/**
 * POST /auth/passkey-credentials — the client mirrors a freshly enrolled
 * WebAuthn credential so the credential inventory survives a wallet-vendor
 * switch or outage. publicKey is optional: the server-side vendor SDK omits
 * it, so the client supplies it here to backfill.
 */
export const MirrorPasskeyCredentialSchema = z.object({
  credentialId: z.string().min(1).max(1024),
  publicKey: z.string().min(1).max(4096).optional(),
});
export type MirrorPasskeyCredentialRequest = z.infer<
  typeof MirrorPasskeyCredentialSchema
>;

/**
 * The contact address, given after the account exists.
 *
 * Not a credential: it never signs anyone in. It anchors the recovery signer
 * and receives the notices that tell a Consumer their keys changed.
 */
/** Asks for a code at an address the Consumer is claiming. */
export const RequestEmailCodeSchema = z.object({
  email: z.string().email(),
});

export type RequestEmailCodeRequest = z.infer<typeof RequestEmailCodeSchema>;

/**
 * Records a contact address and the code that proves it, in one act.
 *
 * The code is not optional. S3 is anchored on this address at Account
 * creation, so an unproved one buys an Account whose only route back points at
 * an inbox nobody reads, discoverable only once the phone is already lost.
 *
 * Unlike a rotation, nothing here spans more than one call, so the grant stays
 * an internal detail rather than something the client has to carry.
 */
export const SetEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  /** The six digits from `auth/email/challenge`, sent to this address. */
  code: z.string().regex(/^\d{6}$/, 'a code is six digits'),
});
export type SetEmailRequest = z.infer<typeof SetEmailSchema>;

/** Asks for a code at an address nobody has an account on. Unauthenticated. */
export const SignupEmailChallengeSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type SignupEmailChallengeRequest = z.infer<
  typeof SignupEmailChallengeSchema
>;

/**
 * Proves the address and comes back with a sign-up token. Unauthenticated.
 *
 * The token is the only thing that carries the proof forward: the passkey
 * created next is a fresh Privy user with no email, and this is how the
 * exchange knows which row it belongs on.
 */
export const SignupEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().regex(/^\d{6}$/, 'a code is six digits'),
});
export type SignupEmailRequest = z.infer<typeof SignupEmailSchema>;
