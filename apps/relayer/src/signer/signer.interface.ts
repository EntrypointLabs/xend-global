/**
 * Fee-payer signer seam (anti-lock-in). Co-sign code depends only on this
 * interface, so a Turnkey / cloud-KMS signer can drop in later by binding a
 * different adapter without touching the co-sign pipeline. Mirrors the
 * repo's WALLET_PROVIDER / SOLANA_RPC provider-seam pattern.
 */
export const FEE_PAYER_SIGNER = Symbol("FeePayerSigner");

export interface FeePayerSigner {
  /** The fee-payer public key (base58), derived from the key at boot. */
  readonly address: string;

  /**
   * Partial-sign the given wire transaction as the fee payer, MERGING the
   * fee-payer signature into the existing signature set (the Consumer's
   * signature is preserved). Input and output are base64-encoded wire
   * transactions. The message bytes are never mutated: signatures are
   * independent over one message, so the relayer can only add its own.
   */
  signTransaction(wireTxBase64: string): Promise<string>;
}
