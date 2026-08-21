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
/**
 * Enrolling, either from scratch or picking up an attempt that was cut short.
 *
 * The resume shape carries a bare public key, which looks like the thing the
 * fresh shape deliberately refuses to accept. It is safe only because the
 * backend will not take the caller's word for it: the key is honoured just when
 * an approval signer for that Consumer and that key is already on file, having
 * been attested on an earlier attempt. An unknown key is refused.
 */
export const EnrolAccountSchema = z.union([
  z.object({
    platform: z.enum(['ios', 'android']),
    /** Base64: the App Attest object on iOS, the certificate chain on Android. */
    attestation: z.string().min(1),
    nonce: z.string().min(1),
  }),
  z.object({
    /** Compressed P-256 public key, hex, attested on an earlier attempt. */
    hardwarePublicKey: z.string().min(1),
  }),
]);

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

/**
 * The band a Spend crosses on one signature, as the Consumer's Account
 * currently has it.
 *
 * Amounts are integer strings at the mint's decimals. A u64 does not survive
 * JSON's number, and the caps are chosen so that today's do, which is the kind
 * of thing that stops being true quietly.
 */
export const SpendingLimitResponseSchema = z.object({
  mint: z.string(),
  maxPerUse: z.string(),
  maxPerPeriod: z.string(),
  remainingInPeriod: z.string(),
  period: z.enum(['OneTime', 'Daily', 'Weekly', 'Monthly']),
});

export type SpendingLimitResponse = z.infer<typeof SpendingLimitResponseSchema>;

export const AccountResponseSchema = z.object({
  /** The vault PDA. The Consumer's address everywhere. */
  address: z.string(),
  signers: z.object({ primary: z.string(), approval: z.string() }),
  approvalSubOrgId: z.string(),
  /**
   * Null while the Account has no limit, which is every Account until
   * provisioning lands the policy. Null is not "no ceiling": with nothing
   * admitting a Spend on one signature, every Spend takes two.
   */
  spendingLimit: SpendingLimitResponseSchema.nullable(),
});

export type AccountResponse = z.infer<typeof AccountResponseSchema>;
