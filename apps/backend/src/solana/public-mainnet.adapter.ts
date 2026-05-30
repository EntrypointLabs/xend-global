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
  ConfirmedTransferEvent,
  SignatureStatus,
  SolanaRpc,
  TokenBalance,
} from './solana-rpc.interface';
import {
  accountExistsViaConnection,
  getRecentBlockhashViaConnection,
  getSignatureStatusesViaConnection,
  getTokenBalancesViaConnection,
  sendRawTransactionViaConnection,
  streamConfirmedTransfersViaConnection,
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
 * `streamConfirmedTransfers` works against the public RPC — we use
 * cluster-agnostic JSON-RPC `getSignaturesForAddress` +
 * `getParsedTransaction` and never depend on Helius's enhanced
 * endpoint. This means the reconciliation safety net survives a Helius
 * outage.
 *
 * The webhook control-plane helpers (`registerWebhookAddress`,
 * `unregisterWebhookAddress`, `verifyWebhookSignature`) are
 * Helius-only by design: there is no public-RPC webhook product to
 * fall back to. They throw NotImplementedException so any accidental
 * use surfaces loudly.
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

  accountExists(address: WalletAddress): Promise<boolean> {
    return accountExistsViaConnection(this.connection, address);
  }

  streamConfirmedTransfers(
    owner: WalletAddress,
    sinceSlot: bigint,
  ): AsyncIterable<ConfirmedTransferEvent> {
    return streamConfirmedTransfersViaConnection(
      this.connection,
      owner,
      sinceSlot,
    );
  }

  registerWebhookAddress(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    walletAddress: WalletAddress,
  ): Promise<void> {
    throw new NotImplementedException(
      'PublicMainnetAdapter.registerWebhookAddress: webhooks are Helius-only',
    );
  }

  unregisterWebhookAddress(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    walletAddress: WalletAddress,
  ): Promise<void> {
    throw new NotImplementedException(
      'PublicMainnetAdapter.unregisterWebhookAddress: webhooks are Helius-only',
    );
  }

  verifyWebhookSignature(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rawBody: Buffer,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    signature: string,
  ): void {
    throw new NotImplementedException(
      'PublicMainnetAdapter.verifyWebhookSignature: webhooks are Helius-only',
    );
  }
}
