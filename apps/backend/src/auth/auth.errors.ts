/**
 * The contact address already anchors another Account's recovery signer. Kept
 * HTTP-framework-agnostic (plain Error subclass); the controller maps it to
 * 409 EMAIL_IN_USE.
 */
export class EmailInUseError extends Error {
  readonly code = 'EMAIL_IN_USE';
  constructor(message: string) {
    super(message);
    this.name = 'EmailInUseError';
  }
}

/**
 * A passkey credential is already mirrored under a different account. Kept
 * HTTP-framework-agnostic (plain Error subclass); the controller maps it to
 * 409 CREDENTIAL_CONFLICT.
 */
export class CredentialConflictError extends Error {
  readonly code = 'CREDENTIAL_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'CredentialConflictError';
  }
}

/**
 * The Consumer already has an Account, so the address on file anchors a
 * signer in its set and is not edited. It moves by rotating that signer
 * through a settings change; the controller maps this to 409
 * EMAIL_ROTATION_REQUIRED so the app can send them there.
 */
export class EmailRotationRequiredError extends Error {
  readonly code = 'EMAIL_ROTATION_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'EmailRotationRequiredError';
  }
}
