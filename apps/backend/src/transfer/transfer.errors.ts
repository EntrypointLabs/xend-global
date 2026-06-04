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
