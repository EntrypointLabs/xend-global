import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
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
 * Per-method policy:
 *   READ paths (getRecentBlockhash, getTokenBalances,
 *   getSignatureStatuses) — try primary; on any thrown error log and
 *   fall back to the public endpoint. The fallback uses the same
 *   `Connection`-based shape so a hit returns identical data.
 *
 *   WRITE path (sendRawTransaction) — PRIMARY ONLY. Failure
 *   propagates. See class doc on no-double-broadcast below.
 *
 * IMPORTANT — sendRawTransaction does NOT fall back.
 *   If Helius accepts a sendTransaction but our timeout fires before
 *   the response, retrying against public-mainnet risks double-
 *   broadcast. The Solana network coalesces duplicate signatures (same
 *   blockhash + signer + instructions = same signature), so the chain
 *   itself is idempotent. BUT: if the first attempt actually failed on
 *   Helius for a reason that does not change between RPCs (insufficient
 *   lamports, ATA missing, blockhash expired), the second attempt also
 *   fails, wasting latency and burning a blockhash. The honest
 *   behaviour is to surface the Helius failure directly and let the
 *   caller reissue `prepare` (fresh blockhash + intentId) per spec
 *   §5.4.
 *
 *   This invariant is exercised by a dedicated unit test
 *   (`sendRawTransaction does NOT fallback`) — do not relax it without
 *   updating both the test and the spec.
 *
 * `streamConfirmedTransfers` stays a stub. Phase 2 implements the
 * tailer; failover at the stream level is more nuanced than per-call
 * (we cannot replay a missed stream slot from a different provider's
 * webhooks).
 *
 * Spec: docs/specs/migration-already-built-features.md §6, §5.4.
 */
@Injectable()
export class FailoverSolanaRpc implements SolanaRpc {
  private readonly logger = new Logger(FailoverSolanaRpc.name);

  constructor(
    private readonly primary: HeliusAdapter,
    private readonly fallback: PublicMainnetAdapter,
  ) {}

  async getRecentBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    return this.withFallback('getRecentBlockhash', (rpc) =>
      rpc.getRecentBlockhash(),
    );
  }

  async getTokenBalances(owner: WalletAddress): Promise<TokenBalance[]> {
    return this.withFallback('getTokenBalances', (rpc) =>
      rpc.getTokenBalances(owner),
    );
  }

  /**
   * Primary-only by design. Does NOT fall back to public-mainnet on
   * failure. See class doc and the dedicated `does NOT fallback` test.
   */
  sendRawTransaction(signedTxBase64: string): Promise<string> {
    return this.primary.sendRawTransaction(signedTxBase64);
  }

  async getSignatureStatuses(signatures: string[]): Promise<SignatureStatus[]> {
    return this.withFallback('getSignatureStatuses', (rpc) =>
      rpc.getSignatureStatuses(signatures),
    );
  }

  streamConfirmedTransfers(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    owner: WalletAddress,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    sinceSlot: bigint,
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

  /**
   * Generic read-path failover: try primary, on throw log + try
   * fallback. If both fail, the fallback's error propagates so the
   * caller can map it to RPC_UNAVAILABLE (502).
   */
  private async withFallback<T>(
    method: string,
    fn: (rpc: SolanaRpc) => Promise<T>,
  ): Promise<T> {
    try {
      return await fn(this.primary);
    } catch (err) {
      this.logger.warn(
        `Helius ${method} failed; falling back to public mainnet`,
        err,
      );
      return await fn(this.fallback);
    }
  }
}
