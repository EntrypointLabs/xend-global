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

/**
 * A signed provisioning step.
 *
 * Carries only the transaction. Which step it is was decided when the backend
 * compiled it and is fixed by the signatures on it, so a step label from the
 * client could only contradict the bytes, never change what they do.
 */
export const SubmitProvisioningStepSchema = z.object({
  signedTxBase64: z.string().min(1),
});

export type SubmitProvisioningStepDto = z.infer<
  typeof SubmitProvisioningStepSchema
>;

export const AccountResponseSchema = z.object({
  /** The vault PDA. The Consumer's address everywhere. */
  address: z.string(),
  signers: z.object({ primary: z.string(), approval: z.string() }),
  approvalSubOrgId: z.string(),
});

export type AccountResponse = z.infer<typeof AccountResponseSchema>;
