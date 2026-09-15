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

/**
 * A resume-style enrolment named a hardware key this account never attested.
 * The ordinary answer on a phone that held a different account; the caller
 * falls through to a fresh attestation. Mapped to 409 DEVICE_NOT_ATTESTED.
 */
export class DeviceNotAttestedError extends Error {
  readonly code = 'DEVICE_NOT_ATTESTED';
  constructor(message: string) {
    super(message);
    this.name = 'DeviceNotAttestedError';
  }
}

/**
 * A Spending Limit change the Account will not take: another change already
 * holds the next index, or the terms asked for are ones the package refuses.
 * The message is the Consumer's to act on, so it survives to the client.
 * Mapped to 409 SPENDING_LIMIT_CHANGE_REFUSED.
 */
export class SpendingLimitChangeError extends Error {
  readonly code = 'SPENDING_LIMIT_CHANGE_REFUSED';
  constructor(message: string) {
    super(message);
    this.name = 'SpendingLimitChangeError';
  }
}
