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
