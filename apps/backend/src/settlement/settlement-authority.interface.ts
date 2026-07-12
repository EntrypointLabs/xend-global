/**
 * The settlement authority signer seam (ADR 0010 shape). The authority owns
 * the direct-USDC pilot settlement token accounts (it provisions them and
 * authority-signs refunds out of them) and is the pilot attribution root.
 *
 * It is NEVER on the payment hot path: a payment settlement is Consumer-
 * signed and relayer-co-signed, never authority-signed. The authority signs
 * only the ops paths (provisioning a settlement token account, and
 * reverse()/refund transfers), and NEVER co-signs through the relayer (whose
 * allowlist deliberately excludes the System program, Phase 3).
 */

export const SETTLEMENT_AUTHORITY_SIGNER = Symbol('SettlementAuthoritySigner');

export interface SettlementAuthoritySigner {
  /** The authority pubkey (base58); the enumeration/attribution root. */
  readonly address: string;
  /**
   * Add the authority's signature to a base64 wire transaction and
   * broadcast it, returning the transaction signature. The wire tx may
   * already carry other partial signatures (e.g. an ephemeral new-account
   * key on provisioning).
   */
  signAndSend(wireTxBase64: string): Promise<string>;
}
