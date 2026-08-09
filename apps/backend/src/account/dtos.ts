import { z } from 'zod';

/**
 * Enrolment request.
 *
 * Deliberately carries neither the hardware public key nor the recovery
 * signer. Both are produced server-side: the hardware key is read out of the
 * verified attestation, and the recovery signer is minted by RecoveryService.
 *
 * A client that could nominate either would only need to supply an address it
 * already controls to hold two of the three signers, which is the threshold.
 */
export const EnrolAccountSchema = z.object({
  platform: z.enum(['ios', 'android']),
  /** Base64: the App Attest object on iOS, the certificate chain on Android. */
  attestation: z.string().min(1),
  nonce: z.string().min(1),
});

export type EnrolAccountDto = z.infer<typeof EnrolAccountSchema>;

export const AccountResponseSchema = z.object({
  /** The vault PDA. The Consumer's address everywhere. */
  address: z.string(),
  signers: z.object({ primary: z.string(), approval: z.string() }),
});

export type AccountResponse = z.infer<typeof AccountResponseSchema>;
