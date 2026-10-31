/**
 * Typed errors thrown by FeedbackService and mapped to HTTP codes by
 * FeedbackController. Each message is fixed and reaches the Consumer as
 * written.
 */

/** More feedback in the last day than one Consumer is allowed. */
export class FeedbackRateLimitedError extends Error {
  readonly code = 'FEEDBACK_RATE_LIMITED';
  constructor() {
    super('Thank you, we have your feedback. You can send more tomorrow.');
    this.name = 'FeedbackRateLimitedError';
  }
}
