import { PublicKey } from '@solana/web3.js';
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
    /**
     * iOS only: the Secure Enclave key the attestation's challenge commits to.
     * Proven by Apple's signature over that challenge, not taken on trust.
     */
    hardwarePublicKey: z.string().min(1).optional(),
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

/** A signed rejection of a staged settings change. */
export const SubmitRejectionSchema = z.object({
  signedTxBase64: z.string().min(1),
});
export type SubmitRejectionDto = z.infer<typeof SubmitRejectionSchema>;

/**
 * An external wallet the Consumer already controls, offered as a recovery key.
 *
 * Only an address: the Consumer holds that key, and the backend never sees or
 * stores anything else about it. Validated as a base58 Ed25519 public key here
 * so a typo is refused at the edge rather than becoming a settings change that
 * fails on chain a day later, having consumed an index and the whole time lock.
 */
export const AddRecoveryWalletSchema = z.object({
  address: z.string().refine(canSign, 'not an address that can sign'),
});

/**
 * Whether an address could ever sign.
 *
 * Any 32 bytes parse as a PublicKey, program-derived addresses included, and
 * those sit off the Ed25519 curve with no private key at all. One accepted as
 * a recovery key would be indistinguishable from a real one until the day it
 * was needed, and the program would take it happily.
 */
function canSign(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

export type AddRecoveryWalletDto = z.infer<typeof AddRecoveryWalletSchema>;

/** A signed step of a recovery key change. See {@link SubmitProvisioningStepSchema}. */
export const SubmitRecoveryChangeSchema = z.object({
  signedTxBase64: z.string().min(1),
});

export type SubmitRecoveryChangeDto = z.infer<
  typeof SubmitRecoveryChangeSchema
>;

/**
 * The code from a recovery mail.
 *
 * Six digits as a string rather than a number: leading zeroes are part of the
 * code, and `012345` parsed as a number is a different code.
 */
export const VerifyRecoveryCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'a recovery code is six digits'),
});

export type VerifyRecoveryCodeDto = z.infer<typeof VerifyRecoveryCodeSchema>;

/**
 * Starting a device rotation.
 *
 * The hardware key is the new phone's, already attested through the enrolment
 * path, and the grant is the proof that the Consumer's inbox asked for this.
 */
export const StartDeviceRotationSchema = z.object({
  grantId: z.string().min(1),
  hardwarePublicKey: z.string().min(1),
  security: z.string().min(1).optional(),
});

export type StartDeviceRotationDto = z.infer<typeof StartDeviceRotationSchema>;

export const NextDeviceRotationSchema = z.object({
  /** Only the recovery-approval step needs it, so later steps may omit it. */
  grantId: z.string().min(1).optional(),
});

export type NextDeviceRotationDto = z.infer<typeof NextDeviceRotationSchema>;
