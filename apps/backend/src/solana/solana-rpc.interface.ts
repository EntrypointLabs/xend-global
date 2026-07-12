/**
 * Anti-lock-in seam for Solana RPC access. Helius is the primary adapter,
 * with a public-mainnet adapter as fallback, both behind this interface;
 * `FailoverSolanaRpc` composes the two. QuickNode or Triton can be added
 * later as additional adapters.
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

/**
 * Decoded SPL token transfer surfaced by the tailer, produced from two
 * sources:
 *   - Helius webhook deliveries (hot path, EventParser.parseDecoded).
 *   - getSignaturesForAddress + getParsedTransaction since-slot replay
 *     (boot path / reconcile fallback, streamConfirmedTransfers).
 *
 * `direction` is intentionally NOT included — it is computed at write
 * time by comparing fromAddress/toAddress against our owned wallets.
 */
export interface ConfirmedTransferEvent {
  signature: string;
  slot: bigint;
  mint: string;
  amountRaw: bigint;
  fromAddress: WalletAddress;
  toAddress: WalletAddress;
  confirmedAt: Date;
}

export interface SolanaRpc {
  getRecentBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>;

  getTokenBalances(owner: WalletAddress): Promise<TokenBalance[]>;

  sendRawTransaction(signedTxBase64: string): Promise<string>;

  getSignatureStatuses(signatures: string[]): Promise<SignatureStatus[]>;

  /**
   * True iff the on-chain account at `address` exists. Used by
   * /transfers/prepare to decide whether the recipient ATA needs a
   * `createAssociatedTokenAccountInstruction` prepended to the
   * transaction. Cheap RPC call (single `getAccountInfo`).
   */
  accountExists(address: WalletAddress): Promise<boolean>;

  /**
   * Rent-exempt minimum balance (lamports) for an account of `space`
   * bytes. Used by settlement-endpoint provisioning to fund the new
   * classic-SPL token account. A plain read, safe on either leg.
   * SDK-neutral: takes/returns bigint so kit-side callers stay inside the
   * owned seam rather than reaching for a raw kit RPC client (ADR 0020).
   */
  getMinimumBalanceForRentExemption(space: bigint): Promise<bigint>;

  /**
   * The owner (controlling wallet) of an SPL token account, or null when
   * the account does not exist or is not a parseable token account. Used by
   * the direct-USDC refund path to confirm a settlement endpoint is
   * authority-owned before authority-signing a reverse. Plain read.
   */
  getTokenAccountOwner(address: WalletAddress): Promise<string | null>;

  /**
   * Raw u64 amount (as a string) held by a specific SPL token account, or
   * '0' when absent/unreadable. Used by the settlement provider's
   * reconciliation report() to read a single endpoint token account
   * (getTokenBalances is owner-scoped and would commingle per-Merchant
   * authority-owned endpoints). Plain read.
   */
  getTokenAccountBalanceRaw(tokenAccount: WalletAddress): Promise<string>;

  /**
   * Async iterator over confirmed SPL token transfers for an owner
   * since a slot. Boot-time replay + reconciliation safety net for the
   * webhook hot path.
   */
  streamConfirmedTransfers(
    owner: WalletAddress,
    sinceSlot: bigint,
  ): AsyncIterable<ConfirmedTransferEvent>;

  /**
   * Add a wallet to the account-activity webhook subscription.
   *
   * Helius-only by design — webhooks are a Helius control-plane feature
   * and have no parity on the public-mainnet RPC. PublicMainnetAdapter
   * throws NotImplementedException for both helpers.
   *
   * FailoverSolanaRpc proxies to PRIMARY only: control-plane writes
   * cannot be safely double-applied (we'd end up with duplicate webhook
   * subscriptions). On primary failure we surface the error and let the
   * reconciler poll be the safety net.
   *
   * Implementations MUST be idempotent: registering the same address
   * twice is a no-op, not a duplicate row.
   */
  registerWebhookAddress(walletAddress: WalletAddress): Promise<void>;

  /**
   * Remove a wallet from the account-activity webhook subscription.
   * Same Helius-only + primary-only constraints as register.
   */
  unregisterWebhookAddress(walletAddress: WalletAddress): Promise<void>;

  /**
   * Verify the HMAC signature on an incoming webhook delivery. Throws
   * on mismatch (mapped to 401 INVALID_WEBHOOK_SIGNATURE upstream).
   *
   * Helius-specific concern: only the Helius adapter knows the shared
   * secret + header layout. PublicMainnetAdapter throws
   * NotImplementedException. FailoverSolanaRpc proxies to primary only.
   *
   * Synchronous because the only operation is constant-time HMAC
   * comparison; no I/O.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): void;
}
