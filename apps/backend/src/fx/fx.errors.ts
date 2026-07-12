/**
 * Typed errors thrown by the FX quote seam. Plain Error subclasses with a
 * SCREAMING_SNAKE `code`, kept out of @nestjs/common (same posture as
 * transfer.errors.ts).
 */

/** No fresh partner quote and no cached quote inside the staleness cap. */
export class FxQuoteUnavailableError extends Error {
  readonly code = 'FX_QUOTE_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'FxQuoteUnavailableError';
  }
}

/** A rate or amount string is malformed or non-positive. */
export class FxRateInvalidError extends Error {
  readonly code = 'FX_RATE_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'FxRateInvalidError';
  }
}
