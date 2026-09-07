export const RECOVERY_VAULT = Symbol('RECOVERY_VAULT');

export interface SealedKey {
  /** Opaque ciphertext. Never logged, never returned to a client. */
  ciphertext: string;
  /** Identifies which wrapping key sealed it, so keys can be rotated. */
  keyId: string;
  /**
   * The per-seal data key, itself encrypted by KMS. Present only for sealed
   * keys under envelope custody; an env-key seal has nothing to put here.
   */
  wrappedDataKey?: string | null;
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
  /** The id every new seal is written under. */
  readonly currentKeyId: string;
  seal(secretKey: Uint8Array): Promise<SealedKey>;
  open(sealed: SealedKey): Promise<Uint8Array>;
}
