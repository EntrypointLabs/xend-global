/**
 * The settlement authority signer seam (ADR 0010 shape). The authority owns
 * the direct-USDC pilot settlement token accounts (it provisions them and
 * authority-signs refunds out of them) and is the pilot attribution root.
 *
 * ## It is on the payment hot path, as the fee payer
 *
 * It did not used to be. A Payment was a plain SPL transfer the relayer
 * co-signed, and the authority was kept to the ops paths on purpose. That
 * stopped being possible when a Payment became a Spend out of the Consumer's
 * Squads Account: the relayer's allowlist admits ComputeBudget, Token and ATA
 * and nothing else, and widening it to carry a Squads instruction would give
 * away the narrowness that makes the relayer safe to expose.
 *
 * So the authority pays the fee, exactly as it already does for a Send. It is
 * still never an authority over anyone's money: it adds the fee payer's
 * signature to a transaction the Consumer's own signer has already signed, and
 * it only ever signs bytes that match the message pinned on the attempt.
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
