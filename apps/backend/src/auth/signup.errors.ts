/**
 * Typed errors for the pre-passkey half of sign-up. Plain Error subclasses so
 * the service stays HTTP-framework-agnostic; the controller maps them.
 */

/**
 * The sign-up token is missing, spent, expired, or points at a users row that
 * is no longer waiting to be bound. One error for all of them on purpose: the
 * caller holding a bad token learns nothing about why it is bad.
 */
export class SignupTokenInvalidError extends Error {
  readonly code = 'SIGNUP_TOKEN_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'SignupTokenInvalidError';
  }
}

export class TooManySignupAttemptsError extends Error {
  readonly code = 'TOO_MANY_SIGNUP_ATTEMPTS';
  constructor(message: string) {
    super(message);
    this.name = 'TooManySignupAttemptsError';
  }
}
