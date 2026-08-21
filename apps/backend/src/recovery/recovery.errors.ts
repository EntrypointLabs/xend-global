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
