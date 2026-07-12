/**
 * Typed errors thrown by the payment services. Plain Error subclasses with a
 * SCREAMING_SNAKE `code`, kept out of @nestjs/common so the services stay
 * HTTP-framework-agnostic (same posture as transfer.errors.ts).
 */

export class MerchantNotFoundError extends Error {
  readonly code = 'MERCHANT_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'MerchantNotFoundError';
  }
}

export class MerchantSuspendedError extends Error {
  readonly code = 'MERCHANT_SUSPENDED';
  constructor(message: string) {
    super(message);
    this.name = 'MerchantSuspendedError';
  }
}

export class IntentNotFoundError extends Error {
  readonly code = 'INTENT_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'IntentNotFoundError';
  }
}

export class IntentExpiredError extends Error {
  readonly code = 'INTENT_EXPIRED';
  constructor(message: string) {
    super(message);
    this.name = 'IntentExpiredError';
  }
}

export class IntentStateConflictError extends Error {
  readonly code = 'INTENT_STATE_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'IntentStateConflictError';
  }
}

export class AttemptInFlightError extends Error {
  readonly code = 'ATTEMPT_IN_FLIGHT';
  constructor(message: string) {
    super(message);
    this.name = 'AttemptInFlightError';
  }
}
