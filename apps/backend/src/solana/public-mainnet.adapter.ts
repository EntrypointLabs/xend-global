import {
  Injectable,
  Logger,
  NotImplementedException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection } from '@solana/web3.js';
import type { WalletAddress } from '../wallet/wallet-provider.interface';
import {
  SignatureStatus,
  SolanaRpc,
  TokenBalance,
} from './solana-rpc.interface';
import {
  getRecentBlockhashViaConnection,
  getSignatureStatusesViaConnection,
  getTokenBalancesViaConnection,
  sendRawTransactionViaConnection,
} from './web3-connection';

/**
 * PublicMainnetAdapter — fallback SolanaRpc backed by the public
 * mainnet endpoint (default https://api.mainnet-beta.solana.com).
 *
 * Same `Connection`-based shape as HeliusAdapter; the only difference
 * is the URL. The public endpoint is rate-limited, so this is FALLBACK
 * ONLY and only for read paths.
 *
 * `sendRawTransaction` is implemented for parity, but
 * `FailoverSolanaRpc` deliberately does NOT call it on failover. See
 * `failover-solana-rpc.ts` for the rationale.
 *
 * `streamConfirmedTransfers` stays a stub — Phase 2 wires the tailer
 * against Helius webhooks; the public RPC is not the tailer source.
 */
@Injectable()
export class PublicMainnetAdapter implements SolanaRpc, OnModuleInit {
  private readonly logger = new Logger(PublicMainnetAdapter.name);
  private connection!: Connection;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.getOrThrow<string>('SOLANA_PUBLIC_RPC_URL');
    this.connection = new Connection(url, 'confirmed');
    this.logger.log(`PublicMainnetAdapter initialized (${url})`);
  }

  getRecentBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    return getRecentBlockhashViaConnection(this.connection);
  }

  getTokenBalances(owner: WalletAddress): Promise<TokenBalance[]> {
    return getTokenBalancesViaConnection(this.connection, owner);
  }

  sendRawTransaction(signedTxBase64: string): Promise<string> {
    return sendRawTransactionViaConnection(this.connection, signedTxBase64);
  }

  getSignatureStatuses(signatures: string[]): Promise<SignatureStatus[]> {
    return getSignatureStatusesViaConnection(this.connection, signatures);
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
      'PublicMainnetAdapter.streamConfirmedTransfers (Phase 2)',
    );
  }
}
