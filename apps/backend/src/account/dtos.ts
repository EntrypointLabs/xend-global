import { z } from 'zod';

/**
 * Enrolment request.
 *
 * There is deliberately no `hardwarePublicKey` field. The key is read out of
 * the verified attestation instead, so a caller cannot attest with a real
 * device and enrol a software key it controls.
 */
export const EnrolAccountSchema = z.object({
  platform: z.enum(['ios', 'android']),
  /** Base64: the App Attest object on iOS, the certificate chain on Android. */
  attestation: z.string().min(1),
  nonce: z.string().min(1),
  /** S3, created before this call. D10b makes it mandatory at creation. */
  recoverySigner: z.string().min(32),
});

export type EnrolAccountDto = z.infer<typeof EnrolAccountSchema>;

export const AccountResponseSchema = z.object({
  /** The vault PDA. The Consumer's address everywhere. */
  address: z.string(),
  signers: z.object({ primary: z.string(), approval: z.string() }),
});

export type AccountResponse = z.infer<typeof AccountResponseSchema>;
