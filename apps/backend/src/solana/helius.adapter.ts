import { Injectable, NotImplementedException } from '@nestjs/common';
import type { WalletAddress } from '../wallet/wallet-provider.interface';
import {
  SignatureStatus,
  SolanaRpc,
  TokenBalance,
} from './solana-rpc.interface';

/**
 * Helius Solana RPC adapter — STUB.
 *
 * Real implementation lands in Phase 1 against the Helius RPC endpoint
 * (HTTP + WebSocket). This is the PRIMARY RPC; PublicMainnetAdapter is the
 * fallback, composed by FailoverSolanaRpc.
 *
 * Every method throws NotImplementedException with a `(Phase 1)` suffix.
 */
@Injectable()
export class HeliusAdapter implements SolanaRpc {
  async getRecentBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    throw new NotImplementedException(
      'HeliusAdapter.getRecentBlockhash (Phase 1)',
    );
  }

  async getTokenBalances(_owner: WalletAddress): Promise<TokenBalance[]> {
    throw new NotImplementedException(
      'HeliusAdapter.getTokenBalances (Phase 1)',
    );
  }

  async sendRawTransaction(_signedTxBase64: string): Promise<string> {
    throw new NotImplementedException(
      'HeliusAdapter.sendRawTransaction (Phase 1)',
    );
  }

  async getSignatureStatuses(
    _signatures: string[],
  ): Promise<SignatureStatus[]> {
    throw new NotImplementedException(
      'HeliusAdapter.getSignatureStatuses (Phase 1)',
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
      'HeliusAdapter.streamConfirmedTransfers (Phase 2)',
    );
  }
}
