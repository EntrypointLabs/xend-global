/**
 * Typed errors thrown by the settlement services and providers, mapped to
 * HTTP codes by the consuming controllers (Phase 5/6). Kept out of
 * @nestjs/common so the services stay framework-agnostic (a worker or CLI
 * can consume them without dragging in Nest exception shapes). Wire shape
 * is `{ code, message }` per the repo convention.
 */

/** No registered adapter serves the requested currency/provider (e.g. an
 *  NGN Merchant before the Blockradar adapter ships in Phase 8). */
export class SettlementProviderUnavailableError extends Error {
  readonly code = 'SETTLEMENT_PROVIDER_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'SettlementProviderUnavailableError';
  }
}

/** The provider or endpoint cannot reverse a settlement (e.g. a recorded
 *  merchant-own address, for which Xend holds no signer). */
export class RefundNotSupportedError extends Error {
  readonly code = 'REFUND_NOT_SUPPORTED';
  constructor(message: string) {
    super(message);
    this.name = 'RefundNotSupportedError';
  }
}

/** No provisioned settlement endpoint exists for the Merchant. */
export class SettlementAccountNotProvisionedError extends Error {
  readonly code = 'SETTLEMENT_ACCOUNT_NOT_PROVISIONED';
  constructor(message: string) {
    super(message);
    this.name = 'SettlementAccountNotProvisionedError';
  }
}

/** The intent is not in a state from which settlement can proceed. */
export class IntentNotSettleableError extends Error {
  readonly code = 'INTENT_NOT_SETTLEABLE';
  constructor(message: string) {
    super(message);
    this.name = 'IntentNotSettleableError';
  }
}

/** The submitted signed transaction's compiled message diverges from the
 *  message pinned at build time. */
export class SettlementMessageMismatchError extends Error {
  readonly code = 'SETTLEMENT_MESSAGE_MISMATCH';
  constructor(message: string) {
    super(message);
    this.name = 'SettlementMessageMismatchError';
  }
}

/** The relayer co-sign call failed; carries the relayer's own error code. */
export class RelayerCosignError extends Error {
  readonly code = 'RELAYER_COSIGN_FAILED';
  constructor(
    message: string,
    readonly relayerCode?: string,
  ) {
    super(message);
    this.name = 'RelayerCosignError';
  }
}

/** A live attempt already holds the one-live-attempt slot for the intent. */
export class AttemptAlreadyLiveError extends Error {
  readonly code = 'ATTEMPT_ALREADY_LIVE';
  constructor(message: string) {
    super(message);
    this.name = 'AttemptAlreadyLiveError';
  }
}

/** The active confirmation poll exhausted its budget without a verdict. */
export class ConfirmationTimeoutError extends Error {
  readonly code = 'CONFIRMATION_TIMEOUT';
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmationTimeoutError';
  }
}
