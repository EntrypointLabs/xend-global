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
  accountExistsViaConnection,
  getRecentBlockhashViaConnection,
  getSignatureStatusesViaConnection,
  getTokenBalancesViaConnection,
  sendRawTransactionViaConnection,
} from './web3-connection';

/**
 * HeliusAdapter — primary SolanaRpc backed by Helius's RPC endpoint.
 *
 * Talks to Helius via a `@solana/web3.js` Connection object. Helius
 * exposes a JSON-RPC superset, so a `Connection` works without bespoke
 * client code. Helius's enhanced webhooks + the parsed-transaction
 * endpoint land in Phase 2 (RPC tailer); here we cover only the four
 * methods the wallet/transfer modules need.
 *
 * Hard rule (from PLAN.md): use `Connection`, never raw fetch.
 *
 * `streamConfirmedTransfers` stays a stub — implemented in Phase 2
 * when we wire the Helius webhook ingest.
 */
@Injectable()
export class HeliusAdapter implements SolanaRpc, OnModuleInit {
  private readonly logger = new Logger(HeliusAdapter.name);
  private connection!: Connection;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.getOrThrow<string>('HELIUS_RPC_URL');
    // The Helius URL already embeds the API key as a query param per
    // the convention `https://devnet.helius-rpc.com/?api-key=...`. We
    // do not log the URL because it carries the key.
    this.connection = new Connection(url, 'confirmed');
    this.logger.log('HeliusAdapter initialized');
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
      'HeliusAdapter.streamConfirmedTransfers (Phase 2)',
    );
  }
}
