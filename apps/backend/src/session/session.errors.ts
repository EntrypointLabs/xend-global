/**
 * Typed errors thrown by SessionService. Plain Error subclasses with a
 * SCREAMING_SNAKE `code`, kept out of @nestjs/common (same posture as
 * transfer.errors.ts).
 */

/**
 * One code for every validity failure (missing, revoked, expired, idle,
 * merchant-mismatch) so the API is not a validity oracle a caller can probe.
 */
export class SessionInvalidError extends Error {
  readonly code = 'SESSION_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'SessionInvalidError';
  }
}

/** Revocation of a Session the caller does not own, or that does not exist. */
export class SessionNotFoundError extends Error {
  readonly code = 'SESSION_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionVelocityExceededError extends Error {
  readonly code = 'SESSION_VELOCITY_EXCEEDED';
  constructor(message: string) {
    super(message);
    this.name = 'SessionVelocityExceededError';
  }
}
