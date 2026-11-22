/** Swap is switched off, or not available on this cluster. */
export class SwapUnavailableError extends Error {
  readonly code = 'SWAP_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'SwapUnavailableError';
  }
}

/** No venue would price the pair, or the route it offered cannot execute. */
export class NoSwapRouteError extends Error {
  readonly code = 'NO_ROUTE';
  constructor(message: string) {
    super(message);
    this.name = 'NoSwapRouteError';
  }
}

export class SwapQuoteExpiredError extends Error {
  readonly code = 'QUOTE_EXPIRED';
  constructor(message: string) {
    super(message);
    this.name = 'SwapQuoteExpiredError';
  }
}

/**
 * The Account's above-limit policy predates Swap and does not admit the
 * program a swap calls. Nothing is wrong with the Account; it needs the
 * settings change that rewrites the policy.
 */
export class AccountNeedsUpdateError extends Error {
  readonly code = 'ACCOUNT_NEEDS_UPDATE';
  constructor(message: string) {
    super(message);
    this.name = 'AccountNeedsUpdateError';
  }
}

export class SwapMismatchError extends Error {
  readonly code = 'SWAP_MISMATCH';
  constructor(message: string) {
    super(message);
    this.name = 'SwapMismatchError';
  }
}
