/**
 * Typed errors from Account creation. Plain Error subclasses with a
 * SCREAMING_SNAKE `code`, kept out of @nestjs/common (same posture as
 * recovery.errors.ts).
 */

/**
 * Another creator claimed the settings seed between reading the program config
 * and sending. Expected under concurrency: the seed comes from a global counter
 * shared by every user of the program, so it is racy by construction.
 *
 * This is a retry, not a failure.
 */
export class SeedTakenError extends Error {
  readonly code = 'SEED_TAKEN';
  constructor(message: string) {
    super(message);
    this.name = 'SeedTakenError';
  }
}

export class AccountCreationError extends Error {
  readonly code = 'ACCOUNT_CREATION_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'AccountCreationError';
  }
}

/**
 * A signer was missing, or two roles resolved to the same address.
 *
 * Distinct addresses are not hygiene. Two roles on one address means one
 * compromise yields two of three signers, which is the threshold.
 */
export class IncompleteSignerSetError extends Error {
  readonly code = 'INCOMPLETE_SIGNER_SET';
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteSignerSetError';
  }
}

/**
 * The fresh passkey offered as a replacement primary signer is already the
 * credential of a different account. Mapped to 409 PASSKEY_IN_USE.
 */
export class PasskeyInUseError extends Error {
  readonly code = 'PASSKEY_IN_USE';
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyInUseError';
  }
}
