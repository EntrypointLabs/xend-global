/**
 * Typed errors thrown by the merchant services and guards. Plain Error
 * subclasses with a SCREAMING_SNAKE `code`, kept out of @nestjs/common so the
 * services stay HTTP-framework-agnostic (same posture as transfer.errors.ts).
 * Intent-level cases (MerchantNotFound, IntentNotFound, ...) reuse the Phase 2
 * payment errors and are not redefined here.
 */

export class InvalidApiKeyError extends Error {
  readonly code = 'INVALID_API_KEY';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidApiKeyError';
  }
}

export class MerchantSuspendedError extends Error {
  readonly code = 'MERCHANT_SUSPENDED';
  constructor(message: string) {
    super(message);
    this.name = 'MerchantSuspendedError';
  }
}

export class IdempotencyKeyReuseError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSE';
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyKeyReuseError';
  }
}

export class UnauthorizedInternalError extends Error {
  readonly code = 'UNAUTHORIZED_INTERNAL';
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedInternalError';
  }
}

/** Live-key gate: the Merchant's KYB is not verified. */
export class KybNotVerifiedError extends Error {
  readonly code = 'KYB_NOT_VERIFIED';
  constructor(message: string) {
    super(message);
    this.name = 'KybNotVerifiedError';
  }
}

/** Live-key gate: no provisioned provider settlement endpoint reference. */
export class SettlementDestinationMissingError extends Error {
  readonly code = 'SETTLEMENT_DESTINATION_MISSING';
  constructor(message: string) {
    super(message);
    this.name = 'SettlementDestinationMissingError';
  }
}
