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

/**
 * The route was priced, and by the time it was run the venue would no longer
 * pay within the allowed shortfall. Nothing is wrong with the swap; the price
 * it was quoted at is gone, and a new quote is the way forward.
 */
export class SwapPriceMovedError extends Error {
  readonly code = 'PRICE_MOVED';
  constructor(message: string) {
    super(message);
    this.name = 'SwapPriceMovedError';
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
