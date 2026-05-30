import { Injectable, NotImplementedException } from '@nestjs/common';
import type { WalletAddress } from '../wallet/wallet-provider.interface';
import {
  SignatureStatus,
  SolanaRpc,
  TokenBalance,
} from './solana-rpc.interface';

/**
 * Public-mainnet Solana RPC adapter — STUB.
 *
 * Real implementation lands in Phase 1 against the public mainnet RPC
 * endpoint. This is the FALLBACK adapter; HeliusAdapter is primary.
 * Composed by FailoverSolanaRpc.
 *
 * The public-mainnet RPC is rate-limited; the read paths (balance,
 * blockhash, signature status) survive on it under brief Helius outages.
 * `sendRawTransaction` is intentionally NOT exercised through this adapter
 * by FailoverSolanaRpc — see `failover-solana-rpc.ts` for the rationale.
 *
 * Every method throws NotImplementedException with a `(Phase 1)` suffix.
 */
@Injectable()
export class PublicMainnetAdapter implements SolanaRpc {
  async getRecentBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    throw new NotImplementedException(
      'PublicMainnetAdapter.getRecentBlockhash (Phase 1)',
    );
  }

  async getTokenBalances(_owner: WalletAddress): Promise<TokenBalance[]> {
    throw new NotImplementedException(
      'PublicMainnetAdapter.getTokenBalances (Phase 1)',
    );
  }

  async sendRawTransaction(_signedTxBase64: string): Promise<string> {
    throw new NotImplementedException(
      'PublicMainnetAdapter.sendRawTransaction (Phase 1)',
    );
  }

  async getSignatureStatuses(
    _signatures: string[],
  ): Promise<SignatureStatus[]> {
    throw new NotImplementedException(
      'PublicMainnetAdapter.getSignatureStatuses (Phase 1)',
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
      'PublicMainnetAdapter.streamConfirmedTransfers (Phase 2)',
    );
  }
}
