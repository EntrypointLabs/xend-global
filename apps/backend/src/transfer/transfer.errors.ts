/**
 * Typed errors thrown by TransferService and mapped to HTTP codes by
 * TransferController. Kept out of @nestjs/common so the transfer service
 * stays HTTP-framework-agnostic (a future CLI or worker can consume the
 * same service without dragging in Nest exception shapes).
 */

export class InvalidRecipientError extends Error {
  readonly code = 'INVALID_RECIPIENT';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecipientError';
  }
}

export class UnsupportedMintError extends Error {
  readonly code = 'UNSUPPORTED_MINT';
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedMintError';
  }
}

export class IntentExpiredError extends Error {
  readonly code = 'INTENT_EXPIRED';
  constructor(message: string) {
    super(message);
    this.name = 'IntentExpiredError';
  }
}

/**
 * The submitted signed transaction does not match the one produced by
 * /transfers/prepare for this intent. Raised when the client signs and submits
 * a different transaction than the backend built, which would otherwise let the
 * ledger row (recipient, mint, amount) diverge from what lands on-chain.
 */
export class IntentMismatchError extends Error {
  readonly code = 'INTENT_MISMATCH';
  constructor(message: string) {
    super(message);
    this.name = 'IntentMismatchError';
  }
}

export class RpcUnavailableError extends Error {
  readonly code = 'RPC_UNAVAILABLE';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RpcUnavailableError';
  }
}

/**
 * A Spend that carries one on-chain signature reached submit without a
 * signature from the device key.
 *
 * Distinct from PRESENCE_INVALID so an app too old to produce one can be told
 * to update, rather than shown the message meant for a proof that failed.
 */
export class PresenceProofRequiredError extends Error {
  readonly code = 'PRESENCE_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'PresenceProofRequiredError';
  }
}

/**
 * The device signature did not verify against any key this Consumer enrolled,
 * or the approval signature this route needs is missing from the transaction.
 */
export class PresenceProofInvalidError extends Error {
  readonly code = 'PRESENCE_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'PresenceProofInvalidError';
  }
}
