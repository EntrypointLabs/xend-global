/**
 * SolanaRpc — anti-lock-in seam for Solana RPC access.
 *
 * Per PROJECT.md core essence and spec §6: Helius is the primary adapter, with
 * a public-mainnet adapter as fallback, both behind this interface. A
 * `FailoverSolanaRpc` wrapper composes the two. QuickNode or Triton can be
 * added later as additional adapters.
 *
 * Spec: docs/specs/migration-already-built-features.md §6.
 */

import type { WalletAddress } from '../wallet/wallet-provider.interface';

/** DI token for the active SolanaRpc binding. */
export const SOLANA_RPC = Symbol('SolanaRpc');

export interface TokenBalance {
  mint: string;
  amountRaw: bigint;
  decimals: number;
}

export interface SignatureStatus {
  signature: string;
  slot: bigint | null;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
  err: unknown;
}

export interface SolanaRpc {
  getRecentBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>;

  getTokenBalances(owner: WalletAddress): Promise<TokenBalance[]>;

  sendRawTransaction(signedTxBase64: string): Promise<string>;

  getSignatureStatuses(signatures: string[]): Promise<SignatureStatus[]>;

  /** Async iterator over confirmed transactions for an owner since a slot. */
  streamConfirmedTransfers(
    owner: WalletAddress,
    sinceSlot: bigint,
  ): AsyncIterable<{
    signature: string;
    slot: bigint;
    mint: string;
    amountRaw: bigint;
    fromAddress: WalletAddress;
    toAddress: WalletAddress;
  }>;
}
