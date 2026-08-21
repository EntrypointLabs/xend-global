/**
 * Proves that the key being enrolled as the approval signer (S2) really lives
 * in the phone's secure hardware.
 *
 * This is not defence in depth, it is the possession anchor itself. The iOS
 * simulator satisfies `kSecAttrTokenIDSecureEnclave` against a host-side
 * software implementation, and a key blob generated in one simulator restores
 * in another and yields the same public key. Android silently falls back from
 * StrongBox to TEE. At the JS layer none of that is distinguishable. Without
 * attestation a simulator stub enrols as S2 and "physical possession of the
 * phone" is a claim with nothing behind it.
 */

export const ATTESTATION_VERIFIER = Symbol('ATTESTATION_VERIFIER');
export const ATTESTATION_NONCE_STORE = Symbol('ATTESTATION_NONCE_STORE');

export type DevicePlatform = 'ios' | 'android';

export interface AttestationRequest {
  platform: DevicePlatform;
  /** Base64. The App Attest object on iOS, the certificate chain on Android. */
  attestation: string;
  /** The nonce this attestation was produced for. Single use. */
  nonce: string;
}

export interface VerifiedAttestation {
  /**
   * The attested public key, compressed P-256, hex. Taken from the attestation
   * itself rather than from the client, so a client cannot enrol one key while
   * attesting another.
   */
  hardwarePublicKey: string;
  /** `strongbox` only appears on Android; iOS reports `secure_enclave`. */
  security: 'secure_enclave' | 'strongbox' | 'tee';
}

export interface AttestationVerifier {
  verify(request: AttestationRequest): Promise<VerifiedAttestation>;
}

/**
 * Nonces are server-issued, short-lived and single-use.
 *
 * Single use is the load-bearing property. A replayable attestation lets one
 * genuine device vouch for any number of enrolments, including from a machine
 * with no secure hardware at all.
 */
export interface AttestationNonceStore {
  issue(userId: string): Promise<string>;
  /** Returns false if the nonce is unknown, expired, already spent, or another user's. */
  consume(userId: string, nonce: string): Promise<boolean>;
}
