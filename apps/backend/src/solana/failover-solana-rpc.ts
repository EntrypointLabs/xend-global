import { Injectable, Logger } from '@nestjs/common';
import type { WalletAddress } from '../wallet/wallet-provider.interface';
import { HeliusAdapter } from './helius.adapter';
import { PublicMainnetAdapter } from './public-mainnet.adapter';
import {
  ConfirmedTransferEvent,
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
 *   CONTROL plane (registerWebhookAddress, unregisterWebhookAddress,
 *   verifyWebhookSignature) — PRIMARY ONLY. Webhooks are a Helius
 *   feature; the public mainnet RPC has no equivalent. Double-applying
 *   a registration would create a duplicate webhook subscription and a
 *   duplicate-delivery storm, so we surface primary failures directly
 *   and let the reconciler poll be the safety net.
 *
 *   STREAM (streamConfirmedTransfers) — try primary; if the *first*
 *   page errors, fall back to the public adapter. We cannot mid-stream
 *   failover (a partially-consumed iterator carries pagination state
 *   only the originating connection knows), so the failover decision
 *   is made up-front.
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
 *   caller reissue `prepare` (fresh blockhash + intentId).
 *
 *   This invariant is exercised by a dedicated unit test
 *   (`sendRawTransaction does NOT fallback`) — do not relax it without
 *   updating the test.
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

  async accountExists(address: WalletAddress): Promise<boolean> {
    return this.withFallback('accountExists', (rpc) =>
      rpc.accountExists(address),
    );
  }

  /**
   * Stream confirmed transfers. Attempts primary first; if priming the
   * iterator (first page) throws, retries against the fallback adapter
   * and yields from there. Mid-stream failover is NOT supported (see
   * class doc).
   */
  streamConfirmedTransfers(
    owner: WalletAddress,
    sinceSlot: bigint,
  ): AsyncIterable<ConfirmedTransferEvent> {
    const primary = this.primary;
    const fallback = this.fallback;
    const logger = this.logger;
    return {
      [Symbol.asyncIterator](): AsyncIterator<ConfirmedTransferEvent> {
        let inner: AsyncIterator<ConfirmedTransferEvent> | undefined;
        let primed = false;
        const prime = (): void => {
          if (primed) return;
          try {
            inner = primary
              .streamConfirmedTransfers(owner, sinceSlot)
              [Symbol.asyncIterator]();
          } catch (err) {
            logger.warn(
              `Helius streamConfirmedTransfers failed at prime; falling back to public mainnet`,
              err,
            );
            inner = fallback
              .streamConfirmedTransfers(owner, sinceSlot)
              [Symbol.asyncIterator]();
          }
          primed = true;
        };
        return {
          next(): Promise<IteratorResult<ConfirmedTransferEvent>> {
            try {
              prime();
            } catch (err) {
              return Promise.reject(
                err instanceof Error ? err : new Error(String(err)),
              );
            }
            return inner!.next();
          },
        };
      },
    };
  }

  // ── Control plane (Helius-only) ───────────────────────────────────

  registerWebhookAddress(walletAddress: WalletAddress): Promise<void> {
    return this.primary.registerWebhookAddress(walletAddress);
  }

  unregisterWebhookAddress(walletAddress: WalletAddress): Promise<void> {
    return this.primary.unregisterWebhookAddress(walletAddress);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): void {
    return this.primary.verifyWebhookSignature(rawBody, signature);
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
