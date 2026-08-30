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
