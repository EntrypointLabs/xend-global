/**
 * Typed errors thrown by the capability services. Plain Error subclasses
 * with a SCREAMING_SNAKE `code`, kept out of @nestjs/common so the services
 * stay HTTP-framework-agnostic (same posture as transfer.errors.ts).
 */

export class UnknownConsumerError extends Error {
  readonly code = 'UNKNOWN_CONSUMER';
  constructor(message: string) {
    super(message);
    this.name = 'UnknownConsumerError';
  }
}

export class InsufficientBalanceError extends Error {
  readonly code = 'INSUFFICIENT_BALANCE';
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

export type CapacityExceededReason =
  | 'PER_PAYMENT_CAP'
  | 'DAILY_CAP'
  | 'MONTHLY_CAP';

export class CapacityExceededError extends Error {
  readonly code = 'CAPACITY_EXCEEDED';
  constructor(
    readonly reason: CapacityExceededReason,
    message: string,
  ) {
    super(message);
    this.name = 'CapacityExceededError';
  }
}
