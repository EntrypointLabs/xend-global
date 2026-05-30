import { Injectable, NotImplementedException } from '@nestjs/common';
import type { WalletAddress } from '../wallet/wallet-provider.interface';
import { HeliusAdapter } from './helius.adapter';
import { PublicMainnetAdapter } from './public-mainnet.adapter';
import {
  SignatureStatus,
  SolanaRpc,
  TokenBalance,
} from './solana-rpc.interface';

/**
 * FailoverSolanaRpc — composes HeliusAdapter (primary) with
 * PublicMainnetAdapter (fallback).
 *
 * Real failover logic lands in Phase 1; this is the skeleton. The shape of
 * each method matches `SolanaRpc` so consumers in `wallet`, `transfer`, and
 * `activity` modules can wire to `SOLANA_RPC` without knowing which adapter
 * answers each call.
 *
 * IMPORTANT — sendRawTransaction does NOT fall back.
 *   Read paths (balance, blockhash, signature status) tolerate fallback
 *   cleanly: a Helius miss followed by a public-mainnet hit returns the
 *   same shape, and stale reads are corrected by the next fetch.
 *
 *   The write path is different. If Helius accepts a sendTransaction but
 *   our timeout fires before the response, then we retry against
 *   public-mainnet, we risk submitting the same transaction twice. The
 *   Solana network coalesces duplicate signatures (same blockhash + same
 *   signer + same instructions == same signature), so the chain itself is
 *   idempotent. BUT: if the first attempt actually failed on Helius for a
 *   reason that does not change between RPCs (insufficient lamports for
 *   fee, ATA missing, blockhash expired), the second attempt also fails,
 *   and we have wasted latency and burned a blockhash. The honest behaviour
 *   is to surface the Helius failure directly and let the caller reissue
 *   `prepare` (which mints a fresh blockhash and intentId) per spec §5.4.
 *
 *   Concretely: HeliusAdapter.sendRawTransaction errors propagate. The
 *   PublicMainnetAdapter is consulted ONLY for read calls.
 *
 * Spec: docs/specs/migration-already-built-features.md §6, §5.4.
 */
@Injectable()
export class FailoverSolanaRpc implements SolanaRpc {
  constructor(
    private readonly primary: HeliusAdapter,
    private readonly fallback: PublicMainnetAdapter,
  ) {}

  async getRecentBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    throw new NotImplementedException(
      'FailoverSolanaRpc.getRecentBlockhash (Phase 1)',
    );
  }

  async getTokenBalances(_owner: WalletAddress): Promise<TokenBalance[]> {
    throw new NotImplementedException(
      'FailoverSolanaRpc.getTokenBalances (Phase 1)',
    );
  }

  /**
   * Primary-only by design. Does NOT fall back to public-mainnet on
   * failure. See class doc for rationale.
   */
  async sendRawTransaction(_signedTxBase64: string): Promise<string> {
    throw new NotImplementedException(
      'FailoverSolanaRpc.sendRawTransaction (Phase 1)',
    );
  }

  async getSignatureStatuses(
    _signatures: string[],
  ): Promise<SignatureStatus[]> {
    throw new NotImplementedException(
      'FailoverSolanaRpc.getSignatureStatuses (Phase 1)',
    );
  }

  streamConfirmedTransfers(
    _owner: WalletAddress,
    _sinceSlot: bigint,
  ): AsyncIterable<{
    signature: string;
    slot: bigint;
    mint: string;
    amountRaw: bigint;
    fromAddress: WalletAddress;
    toAddress: WalletAddress;
  }> {
    throw new NotImplementedException(
      'FailoverSolanaRpc.streamConfirmedTransfers (Phase 2)',
    );
  }
}
