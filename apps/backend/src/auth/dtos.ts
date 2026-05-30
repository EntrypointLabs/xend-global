import { z } from 'zod';

/**
 * /auth/exchange request — a Privy ID token issued to the mobile app
 * after the user completes the Privy email-OTP + embedded-wallet flow.
 * The backend verifies the token, upserts the user + smart_account,
 * and returns our own JWT for subsequent API calls.
 *
 * Spec: docs/specs/migration-already-built-features.md §5.1.
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
