/**
 * The entry token is missing, expired, revoked, or points at an account that
 * is closed. One error for all of them: a caller holding a bad token learns
 * nothing about why it is bad.
 */
export class EntrySessionInvalidError extends Error {
  readonly code = 'ENTRY_SESSION_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'EntrySessionInvalidError';
  }
}

/** A live entry session reached a route that needs the passkey behind it. */
export class EntrySessionForbiddenError extends Error {
  readonly code = 'ENTRY_SESSION_FORBIDDEN';
  constructor(message: string) {
    super(message);
    this.name = 'EntrySessionForbiddenError';
  }
}
