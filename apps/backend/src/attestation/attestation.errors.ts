/**
 * Typed errors from attestation. Plain Error subclasses with a SCREAMING_SNAKE
 * `code`, kept out of @nestjs/common (same posture as recovery.errors.ts).
 *
 * Every one of these means "do not enrol this key". There is no partial pass:
 * a key that cannot be proven hardware-backed is a key that is not.
 */

export class AttestationRejectedError extends Error {
  readonly code = 'ATTESTATION_REJECTED';
  constructor(message: string) {
    super(message);
    this.name = 'AttestationRejectedError';
  }
}

export class AttestationNonceError extends Error {
  readonly code = 'ATTESTATION_NONCE';
  constructor(message: string) {
    super(message);
    this.name = 'AttestationNonceError';
  }
}

export class AttestationNotConfiguredError extends Error {
  readonly code = 'ATTESTATION_NOT_CONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'AttestationNotConfiguredError';
  }
}
