import { z } from 'zod';

/**
 * /auth/exchange request — a Privy ID token issued to the mobile app
 * after the user completes the Privy email-OTP + embedded-wallet flow.
 * The backend verifies the token, upserts the user + smart_account, and
 * returns our own JWT for subsequent API calls.
 */
export const ExchangeRequestSchema = z.object({
  privyIdToken: z.string().min(1),
});
export type ExchangeRequest = z.infer<typeof ExchangeRequestSchema>;

export const ExchangeResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
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
