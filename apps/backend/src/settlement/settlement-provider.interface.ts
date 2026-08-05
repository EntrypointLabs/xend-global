/**
 * The owned settlement seam (ADR 0010 shape, ADR 0015 model). Settlement is
 * pluggable by design because no single vendor is load-bearing: business
 * logic depends only on this interface, and each concrete adapter binds
 * behind the SETTLEMENT_PROVIDERS token. The interface is defined from the
 * domain's needs (provision a destination; handle an incoming settlement;
 * reverse for refunds; report for reconciliation; advertise capabilities),
 * NOT from any one provider's API surface, so a second adapter does not
 * fight the abstraction. No code calls a provider outside its adapter.
 */

/** DI token: the array of registered SettlementProvider adapters (NestJS multi-provider). */
export const SETTLEMENT_PROVIDERS = Symbol('SettlementProviders');

/**
 * Closed union of provider names. 'blockradar' is PRE-ALLOCATED: Phase 8
 * ships the Blockradar adapter by APPENDING it to the SETTLEMENT_PROVIDERS
 * factory array, not by extending this type.
 */
export type SettlementProviderName = 'direct_usdc' | 'blockradar';

export interface SettlementProviderCapabilities {
  provider: SettlementProviderName;
  /** Settlement currencies this adapter serves, e.g. ['USDC'] or ['NGN']. */
  currencies: string[];
  /** Whether reverse() (refund) is supported. */
  refundSupport: boolean;
  /**
   * 'instant' = settled on USDC confirmation (direct-USDC);
   * 'deferred' = settled when the off-ramp completes (Blockradar naira-landed).
   */
  settlementLatency: 'instant' | 'deferred';
}

export interface ProvisionedSettlementEndpoint {
  /** The classic-SPL USDC token account payments land in (the TransferChecked destination). */
  address: string;
  /** Opaque provider reference (Blockradar child-address id, or the direct-USDC token account id). */
  providerReference: string;
  /**
   * Attribution root the address is enumerable from (Xend authority for
   * direct-USDC, master wallet for Blockradar); null when a merchant-own
   * address is merely recorded.
   */
  attributionRef: string | null;
  /** Provider payout config as JSON text (bank config for Blockradar); null for direct-USDC. */
  payoutConfig: string | null;
}

/**
 * Settlement completion verdict. direct-USDC: complete on USDC confirmation.
 * Blockradar (Phase 8): pending until naira lands, then the deferred fields
 * carry the payout result. The optionals are undefined for the direct-USDC
 * adapter.
 */
export interface SettlementCompletion {
  status: 'complete' | 'pending';
  ngnSettledMinor?: string; // naira minor units settled (Blockradar; undefined for direct-USDC)
  completedAt?: string; // ISO completion timestamp (Blockradar)
  providerTxRef?: string; // provider-side payout reference (Blockradar)
}

/**
 * A pluggable settlement destination. Exactly one adapter ships at pilot
 * (direct-USDC); Blockradar is added in Phase 8 behind this same seam.
 */
export interface SettlementProvider {
  readonly capabilities: SettlementProviderCapabilities;

  /** Provision a settlement destination for a Merchant. */
  provision(params: {
    merchantId: string;
    merchantAddress?: string;
  }): Promise<ProvisionedSettlementEndpoint>;

  /**
   * Handle an incoming settlement after on-chain USDC confirmation.
   * direct-USDC: USDC landed -> complete. Blockradar (Phase 8): trigger
   * convert-and-payout -> pending until naira lands.
   *
   * MUST be idempotent per signature: this is called on the poll/webhook/cron
   * race and MAY be invoked multiple times for the same signature, so a real
   * convert-payout side effect must never fire twice.
   */
  handleIncomingSettlement(params: {
    endpointAddress: string;
    signature: string;
    amountRaw: string;
  }): Promise<SettlementCompletion>;

  /**
   * Refund in reverse. direct-USDC: authority-signed USDC transfer back to
   * the Consumer. Blockradar (Phase 8): naira -> USDC reverse.
   */
  reverse(params: {
    endpointAddress: string;
    consumerAddress: string;
    amountRaw: string;
    paymentId: string;
  }): Promise<{ signature: string }>;

  /** Reconciliation report for the endpoint. */
  report(params: {
    endpointAddress: string;
  }): Promise<{ balanceRaw: string; providerReference: string }>;
}
