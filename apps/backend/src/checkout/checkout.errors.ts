/**
 * Typed errors thrown by the checkout HTTP surface. Plain Error subclasses
 * with a SCREAMING_SNAKE `code` (same posture as transfer.errors.ts).
 */

/**
 * The settlement outcome did not arrive inside the blocking authorize window.
 * The Payment may still succeed; the webhook remains the truth signal and the
 * popup shows its pending state. Mapped to a 502-class response.
 */
export class PaymentProcessingError extends Error {
  readonly code = 'PAYMENT_PROCESSING';
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProcessingError';
  }
}

/**
 * The Payment is larger than the band the Account carries on one signature, so
 * it needs the approval signer as well.
 *
 * That signer lives on the Consumer's phone and Checkout cannot reach it, so
 * the Payment has to be finished from the Xend app. Raised before anything is
 * consumed: the intent stays payable, no capacity is spent and no Session is
 * issued, because a Consumer who moves to their phone is completing this
 * Payment rather than starting a new one.
 */
export class ApprovalRequiredError extends Error {
  readonly code = 'APPROVAL_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalRequiredError';
  }
}
