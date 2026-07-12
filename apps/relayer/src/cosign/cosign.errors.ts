/**
 * Typed co-sign errors, each with a readonly SCREAMING_SNAKE code, mirroring
 * apps/backend/src/transfer/transfer.errors.ts. The service stays
 * HTTP-framework-agnostic; the controller maps each to a status. Every one
 * of these means the relayer produced NO signature and did NO broadcast.
 */

export class InstructionNotAllowedError extends Error {
  readonly code = "INSTRUCTION_NOT_ALLOWED";
  constructor(message: string) {
    super(message);
    this.name = "InstructionNotAllowedError";
  }
}

export class AddressLookupTableForbiddenError extends Error {
  readonly code = "ADDRESS_LOOKUP_TABLE_FORBIDDEN";
  constructor(message: string) {
    super(message);
    this.name = "AddressLookupTableForbiddenError";
  }
}

export class WrongFeePayerError extends Error {
  readonly code = "WRONG_FEE_PAYER";
  constructor(message: string) {
    super(message);
    this.name = "WrongFeePayerError";
  }
}

export class InvalidSignerCountError extends Error {
  readonly code = "INVALID_SIGNER_COUNT";
  constructor(message: string) {
    super(message);
    this.name = "InvalidSignerCountError";
  }
}

export class UnsupportedMintError extends Error {
  readonly code = "UNSUPPORTED_MINT";
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMintError";
  }
}

export class WrongDestinationError extends Error {
  readonly code = "WRONG_DESTINATION";
  constructor(message: string) {
    super(message);
    this.name = "WrongDestinationError";
  }
}

export class WrongDecimalsError extends Error {
  readonly code = "WRONG_DECIMALS";
  constructor(message: string) {
    super(message);
    this.name = "WrongDecimalsError";
  }
}

export class FeePayerWritableError extends Error {
  readonly code = "FEE_PAYER_WRITABLE";
  constructor(message: string) {
    super(message);
    this.name = "FeePayerWritableError";
  }
}

export class FeeCeilingExceededError extends Error {
  readonly code = "FEE_CEILING_EXCEEDED";
  constructor(message: string) {
    super(message);
    this.name = "FeeCeilingExceededError";
  }
}

export class MessageMismatchError extends Error {
  readonly code = "MESSAGE_MISMATCH";
  constructor(message: string) {
    super(message);
    this.name = "MessageMismatchError";
  }
}

export class MissingSignatureError extends Error {
  readonly code = "MISSING_SIGNATURE";
  constructor(message: string) {
    super(message);
    this.name = "MissingSignatureError";
  }
}

export class SimulationFailedError extends Error {
  readonly code = "SIMULATION_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "SimulationFailedError";
  }
}

export class BroadcastFailedError extends Error {
  readonly code = "BROADCAST_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "BroadcastFailedError";
  }
}

export class CapExceededError extends Error {
  readonly code = "CAP_EXCEEDED";
  constructor(message: string) {
    super(message);
    this.name = "CapExceededError";
  }
}
