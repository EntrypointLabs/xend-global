/**
 * Typed errors thrown by SupportService and mapped to HTTP codes by
 * SupportController. Plain Error subclasses with a SCREAMING_SNAKE `code`,
 * kept out of @nestjs/common (same posture as transfer.errors.ts).
 *
 * Each message is fixed and reaches the Consumer as written.
 */

/** More requests in the last hour than one Consumer is allowed. */
export class SupportRateLimitedError extends Error {
  readonly code = 'SUPPORT_RATE_LIMITED';
  constructor() {
    super(
      'We have your recent requests and will reply to them. You can send another later.',
    );
    this.name = 'SupportRateLimitedError';
  }
}
