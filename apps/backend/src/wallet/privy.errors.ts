/**
 * Typed errors for the PrivyAdapter. Controllers map these to HTTP
 * responses:
 *   InvalidPrivyTokenError -> 401 INVALID_PRIVY_TOKEN
 *   PrivyUnavailableError  -> 502 PRIVY_UNAVAILABLE
 *
 * They are intentionally NOT subclasses of HttpException so the wallet
 * module stays HTTP-framework-agnostic (a Turnkey adapter swap should
 * not have to import @nestjs/common just to throw a 401).
 */

export class InvalidPrivyTokenError extends Error {
  readonly code = 'INVALID_PRIVY_TOKEN';

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'InvalidPrivyTokenError';
  }
}

export class PrivyUnavailableError extends Error {
  readonly code = 'PRIVY_UNAVAILABLE';

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PrivyUnavailableError';
  }
}

/**
 * Thrown when the Privy user is missing data we depend on (e.g. no email
 * linked, or no Solana embedded wallet). These are configuration / app-
 * setup failures, not transient outages; surfaced as 422 by callers.
 */
export class PrivyUserShapeError extends Error {
  readonly code = 'PRIVY_USER_SHAPE_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'PrivyUserShapeError';
  }
}
