import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection } from '@solana/web3.js';
import * as crypto from 'crypto';
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

/** Helius webhook configuration API base. Helius uses a single host
 *  for both mainnet and devnet webhook config; the underlying RPC
 *  cluster is selected by the webhook's `transactionType` + addresses,
 *  not the config URL. */
const HELIUS_WEBHOOK_API = 'https://api.helius.xyz/v0/webhooks';

interface HeliusWebhookRecord {
  webhookID: string;
  wallet: string;
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType?: string;
  authHeader?: string;
}

/**
 * Primary SolanaRpc backed by Helius's RPC endpoint, via a
 * `@solana/web3.js` Connection object. Helius exposes a JSON-RPC
 * superset, so a `Connection` works without bespoke client code.
 *
 * Webhook control plane:
 *   - `registerWebhookAddress` / `unregisterWebhookAddress` edit the
 *     Helius account-activity webhook subscription via the webhook
 *     config API, keyed on `HELIUS_WEBHOOK_ID`. Ops creates the webhook
 *     once via the Helius dashboard or `bootstrapWebhook()`, drops the
 *     ID into the env, and the adapter mutates the address list in place.
 *   - `verifyWebhookSignature`: HMAC-SHA256 over the raw request body
 *     using `HELIUS_WEBHOOK_SECRET`.
 *
 * RPC goes through `Connection`, never raw fetch. The webhook config API
 * is NOT JSON-RPC and is fetched directly.
 */
@Injectable()
export class HeliusAdapter implements SolanaRpc, OnModuleInit {
  private readonly logger = new Logger(HeliusAdapter.name);
  private connection!: Connection;
  private apiKey!: string;
  private webhookSecret: string | undefined;
  private webhookId: string | undefined;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.getOrThrow<string>('HELIUS_RPC_URL');
    // The Helius URL already embeds the API key as a query param per
    // the convention `https://devnet.helius-rpc.com/?api-key=...`. We
    // do not log the URL because it carries the key.
    this.connection = new Connection(url, 'confirmed');
    this.apiKey = this.config.getOrThrow<string>('HELIUS_API_KEY');
    this.webhookSecret = this.config.get<string>('HELIUS_WEBHOOK_SECRET');
    this.webhookId = this.config.get<string>('HELIUS_WEBHOOK_ID') || undefined;
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
    owner: WalletAddress,
    sinceSlot: bigint,
  ): AsyncIterable<ConfirmedTransferEvent> {
    return streamConfirmedTransfersViaConnection(
      this.connection,
      owner,
      sinceSlot,
    );
  }

  // ── Webhook control plane ─────────────────────────────────────────

  async registerWebhookAddress(walletAddress: WalletAddress): Promise<void> {
    const webhook = await this.fetchWebhook();
    if (webhook.accountAddresses.includes(walletAddress)) {
      this.logger.debug(
        `Webhook already includes ${walletAddress}; skipping update`,
      );
      return;
    }
    const next = [...webhook.accountAddresses, walletAddress];
    await this.editWebhookAddresses(webhook.webhookID, next);
    this.logger.log(
      `Registered ${walletAddress} on Helius webhook ${webhook.webhookID} (now ${next.length} addresses)`,
    );
  }

  async unregisterWebhookAddress(walletAddress: WalletAddress): Promise<void> {
    const webhook = await this.fetchWebhook();
    if (!webhook.accountAddresses.includes(walletAddress)) return;
    const next = webhook.accountAddresses.filter((a) => a !== walletAddress);
    await this.editWebhookAddresses(webhook.webhookID, next);
    this.logger.log(
      `Unregistered ${walletAddress} from Helius webhook ${webhook.webhookID}`,
    );
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): void {
    if (!this.webhookSecret) {
      throw new HttpException(
        {
          code: 'WEBHOOK_NOT_CONFIGURED',
          message: 'HELIUS_WEBHOOK_SECRET not set',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (!signature) {
      throw new HttpException(
        {
          code: 'INVALID_WEBHOOK_SIGNATURE',
          message: 'missing webhook signature header',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    // Helius sends the shared secret raw in the Authorization header
    // (per their webhook docs: "We will set the Authorization header on
    // requests we make to your webhook URL"). Compare in constant time
    // to avoid leaking the secret via timing.
    //
    // We accept either: (a) the raw shared secret directly, or (b) an
    // HMAC-SHA256 hex digest of the request body using the secret —
    // some Helius account tiers / configurations send the latter.
    // Verify both shapes and accept either match.
    const rawMatch = this.constantTimeEquals(signature, this.webhookSecret);
    const expectedHmac = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    const hmacMatch = this.constantTimeEquals(signature, expectedHmac);
    if (!rawMatch && !hmacMatch) {
      throw new HttpException(
        {
          code: 'INVALID_WEBHOOK_SIGNATURE',
          message: 'webhook signature mismatch',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  // ── private ───────────────────────────────────────────────────────

  private constantTimeEquals(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  }

  /**
   * Read the current Helius webhook record. Requires
   * `HELIUS_WEBHOOK_ID` to be set (env-managed; ops creates the
   * webhook once via `bootstrapWebhook()` or the Helius dashboard).
   */
  private async fetchWebhook(): Promise<HeliusWebhookRecord> {
    if (!this.webhookId) {
      throw new HttpException(
        {
          code: 'WEBHOOK_NOT_CONFIGURED',
          message:
            'HELIUS_WEBHOOK_ID not set. Run bootstrapWebhook() once and persist the returned ID to env.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const res = await fetch(
      `${HELIUS_WEBHOOK_API}/${this.webhookId}?api-key=${this.apiKey}`,
      { method: 'GET' },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new HttpException(
        {
          code: 'HELIUS_WEBHOOK_API_ERROR',
          message: `GET webhook ${this.webhookId} failed: ${res.status} ${text}`,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
    return (await res.json()) as HeliusWebhookRecord;
  }

  private async editWebhookAddresses(
    webhookId: string,
    accountAddresses: string[],
  ): Promise<void> {
    const current = await this.fetchWebhook();
    const body = {
      webhookURL: current.webhookURL,
      transactionTypes: current.transactionTypes,
      accountAddresses,
      webhookType: current.webhookType ?? 'enhanced',
      // Echo the authHeader so Helius keeps signing deliveries with the
      // same shared secret on the address-list update.
      authHeader: current.authHeader,
    };
    const res = await fetch(
      `${HELIUS_WEBHOOK_API}/${webhookId}?api-key=${this.apiKey}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new HttpException(
        {
          code: 'HELIUS_WEBHOOK_API_ERROR',
          message: `PUT webhook ${webhookId} failed: ${res.status} ${text}`,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Test-only / ops helper: create the webhook from scratch and return
   * the ID for the operator to persist as HELIUS_WEBHOOK_ID. Not
   * called on the request path — invoked manually once per
   * environment.
   */
  async bootstrapWebhook(opts: {
    webhookURL: string;
    initialAddresses: string[];
    authHeader: string;
  }): Promise<string> {
    const body = {
      webhookURL: opts.webhookURL,
      transactionTypes: ['Any'],
      accountAddresses: opts.initialAddresses,
      webhookType: 'enhancedDevnet',
      authHeader: opts.authHeader,
    };
    const res = await fetch(`${HELIUS_WEBHOOK_API}?api-key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new HttpException(
        {
          code: 'HELIUS_WEBHOOK_API_ERROR',
          message: `POST webhook failed: ${res.status} ${text}`,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
    const record = (await res.json()) as HeliusWebhookRecord;
    this.webhookId = record.webhookID;
    return record.webhookID;
  }
}
