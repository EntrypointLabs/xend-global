/**
 * Typed errors thrown by the recovery services. Plain Error subclasses with a
 * SCREAMING_SNAKE `code`, kept out of @nestjs/common so the services stay
 * HTTP-framework-agnostic (same posture as capability.errors.ts).
 */

export class LastRecoverySignerError extends Error {
  readonly code = 'LAST_RECOVERY_SIGNER';
  constructor(message: string) {
    super(message);
    this.name = 'LastRecoverySignerError';
  }
}

export class UnknownRecoverySignerError extends Error {
  readonly code = 'UNKNOWN_RECOVERY_SIGNER';
  constructor(message: string) {
    super(message);
    this.name = 'UnknownRecoverySignerError';
  }
}

export class DuplicateRecoveryChannelError extends Error {
  readonly code = 'DUPLICATE_RECOVERY_CHANNEL';
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateRecoveryChannelError';
  }
}

export class RecoverySignerLimitError extends Error {
  readonly code = 'RECOVERY_SIGNER_LIMIT';
  constructor(message: string) {
    super(message);
    this.name = 'RecoverySignerLimitError';
  }
}

export class RecoveryChangeInFlightError extends Error {
  readonly code = 'RECOVERY_CHANGE_IN_FLIGHT';
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryChangeInFlightError';
  }
}

export class TooManyRecoveryCodesError extends Error {
  readonly code = 'TOO_MANY_RECOVERY_CODES';
  constructor(message: string) {
    super(message);
    this.name = 'TooManyRecoveryCodesError';
  }
}

export class NoRecoveryChallengeError extends Error {
  readonly code = 'NO_RECOVERY_CHALLENGE';
  constructor(message: string) {
    super(message);
    this.name = 'NoRecoveryChallengeError';
  }
}

export class InvalidRecoveryCodeError extends Error {
  readonly code = 'INVALID_RECOVERY_CODE';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecoveryCodeError';
  }
}

export class ChallengeAttemptsExhaustedError extends Error {
  readonly code = 'CHALLENGE_ATTEMPTS_EXHAUSTED';
  constructor(message: string) {
    super(message);
    this.name = 'ChallengeAttemptsExhaustedError';
  }
}

export class RecoveryGrantExpiredError extends Error {
  readonly code = 'RECOVERY_GRANT_EXPIRED';
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryGrantExpiredError';
  }
}

export class NoRotationInFlightError extends Error {
  readonly code = 'NO_ROTATION_IN_FLIGHT';
  constructor(message: string) {
    super(message);
    this.name = 'NoRotationInFlightError';
  }
}

/**
 * Support has paused the release of the server-held recovery signer, usually
 * because a compromise report is open. The Consumer's own two keys are
 * unaffected: this refuses S3's vote and nothing else.
 */
export class RecoveryReleaseFrozenError extends Error {
  readonly code = 'RECOVERY_RELEASE_FROZEN';
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryReleaseFrozenError';
  }
}

/**
 * The signer anchors the address on file, so it is rotated rather than
 * removed. Removing it would leave the entry point pointing at an inbox with
 * no key behind it.
 */
export class ContactRecoverySignerError extends Error {
  readonly code = 'CONTACT_RECOVERY_SIGNER';
  constructor(message: string) {
    super(message);
    this.name = 'ContactRecoverySignerError';
  }
}

/** The replacement address is already another Consumer's contact address. */
export class ContactEmailTakenError extends Error {
  readonly code = 'CONTACT_EMAIL_TAKEN';
  constructor(message: string) {
    super(message);
    this.name = 'ContactEmailTakenError';
  }
}
