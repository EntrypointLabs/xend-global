/**
 * Typed errors for the Blockradar off-ramp path. Kept out of @nestjs/common so
 * the provider stays framework-agnostic (transfer.errors.ts shape). Each
 * carries a SCREAMING_SNAKE `code` for mapping and logging.
 */

/**
 * The Merchant is not KYB-verified. KYB proper gates live keys at onboarding
 * (Phase 6); this is a defense-in-depth re-check before any convert-payout.
 */
export class MerchantKybRequiredError extends Error {
  readonly code = 'MERCHANT_KYB_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'MerchantKybRequiredError';
  }
}

/**
 * The Merchant's bank destination is not provider-verified (missing config or
 * a name mismatch against the registered business name). No off-ramp runs.
 */
export class DestinationUnverifiedError extends Error {
  readonly code = 'DESTINATION_UNVERIFIED';
  constructor(message: string) {
    super(message);
    this.name = 'DestinationUnverifiedError';
  }
}

/** No off-ramp row exists for the given key. */
export class OfframpNotFoundError extends Error {
  readonly code = 'OFFRAMP_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'OfframpNotFoundError';
  }
}

/** The off-ramp row is not in the state a transition expects. */
export class OfframpStateConflictError extends Error {
  readonly code = 'OFFRAMP_STATE_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'OfframpStateConflictError';
  }
}
