export const RECOVERY_VAULT = Symbol('RECOVERY_VAULT');

export interface SealedKey {
  /** Opaque ciphertext. Never logged, never returned to a client. */
  ciphertext: string;
  /** Identifies which wrapping key sealed it, so keys can be rotated. */
  keyId: string;
}

/**
 * Seals and opens the recovery signer's secret key.
 *
 * The seam exists so the wrapping key can move up the custody order without
 * touching callers: cloud KMS in production, a raw env key at the pilot floor.
 * Same posture as the settlement authority signer.
 *
 * Be precise about what this buys. Xend can open a sealed key, so this is an
 * operational control, not a cryptographic impossibility: the guarantee is that
 * opening requires an email-verified session and is auditable, not that Xend is
 * unable to. The property the design actually rests on is elsewhere, in the
 * threshold: this signer is one of three, and it cannot spend under any path.
 */
export interface RecoveryVault {
  seal(secretKey: Uint8Array): Promise<SealedKey>;
  open(sealed: SealedKey): Promise<Uint8Array>;
}
