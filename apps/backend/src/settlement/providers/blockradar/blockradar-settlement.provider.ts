import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DbService } from '../../../db/db.service';
import {
  merchants,
  paymentAttempts,
  payments,
  settlementAccounts,
  settlementOfframps,
} from '../../../db/schema';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../events/event-publisher.interface';
import type {
  ProvisionedSettlementEndpoint,
  SettlementCompletion,
  SettlementProvider,
  SettlementProviderCapabilities,
} from '../../settlement-provider.interface';
import {
  DestinationUnverifiedError,
  MerchantKybRequiredError,
} from './settlement-offramp.errors';

/** Documented Blockradar API base (withdraw-fiat surface, docs.blockradar.co). */
const BLOCKRADAR_API_BASE = 'https://api.blockradar.co/v1';

/** A Postgres unique-violation from the money-safety signature index. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

/**
 * A parsed, owned Blockradar off-ramp webhook event. Non-owned payloads parse
 * to null and are acknowledged without side effects.
 */
export interface OfframpWebhookEvent {
  /** Terminal meaning: 'paid' = naira landed; 'failed' = payout failed. */
  type: 'paid' | 'processing' | 'failed';
  providerRef: string;
  ngnSettledMinor?: string;
  fxRate?: string;
  providerTxRef?: string;
  completedAt?: string;
}

/**
 * The Blockradar naira settlement adapter — the FIRST implementation of
 * Phase 4's frozen SettlementProvider interface (ADR 0015), registered by
 * APPENDING to the SETTLEMENT_PROVIDERS factory array. Convert-at-settlement:
 * the Consumer's USDC lands at a Blockradar-managed Solana child address under
 * Xend's master wallet, Blockradar auto-sweeps + converts to naira + settles
 * to the Merchant bank; "paid" means naira landed. Blockradar owns the funds
 * path end to end — no merchant signer, no Xend-initiated debit.
 *
 * GATED PER ADR 0019 (Flag #2): the three Solana confirmations are UNCONFIRMED
 * against docs.blockradar.co (Solana off-ramp appears EVM-first; no auto/
 * pre-bound per-Merchant bank payout; no first-class reverse primitive). So the
 * Solana-native money-moving paths (convert-payout in handleIncomingSettlement,
 * reverse) are gated behind BLOCKRADAR_SOLANA_NATIVE_ENABLED (default OFF), and
 * refundSupport defaults false so Phase 6's capability gate keeps naira refunds
 * at REFUND_NOT_SUPPORTED (manual-ops) until confirmation (c) lands. The
 * documented API surface is coded and mocked in tests; no CCTP/cross-chain
 * bridge is built (Solana-only guardrail). Blockradar is the sole vendor
 * importer (ADR 0010 Grid rule): raw fetch stays inside this file.
 */
@Injectable()
export class BlockradarSettlementProvider
  implements SettlementProvider, OnModuleInit
{
  private readonly logger = new Logger(BlockradarSettlementProvider.name);
  private apiKey = '';
  private webhookSecret = '';
  private masterWalletId = '';
  private refundSupported = false;
  private solanaNativeEnabled = false;

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  onModuleInit(): void {
    this.solanaNativeEnabled =
      this.config.get<boolean>('BLOCKRADAR_SOLANA_NATIVE_ENABLED') ?? false;
    this.refundSupported =
      this.config.get<boolean>('BLOCKRADAR_REFUND_SUPPORTED') ?? false;
    this.apiKey = this.config.get<string>('BLOCKRADAR_API_KEY') ?? '';
    this.webhookSecret =
      this.config.get<string>('BLOCKRADAR_WEBHOOK_SECRET') ?? '';
    this.masterWalletId =
      this.config.get<string>('BLOCKRADAR_MASTER_WALLET_ID') ?? '';

    // Fail loud only when the leg is actually turned on. While the Solana
    // confirmations are open the leg is stubbed OFF (Flag #2), so requiring
    // credentials would break boot for the USDC-only pilot; keep them optional
    // until BLOCKRADAR_SOLANA_NATIVE_ENABLED flips true.
    if (this.solanaNativeEnabled) {
      const required: Array<[string, string]> = [
        ['BLOCKRADAR_API_KEY', this.apiKey],
        ['BLOCKRADAR_WEBHOOK_SECRET', this.webhookSecret],
        ['BLOCKRADAR_MASTER_WALLET_ID', this.masterWalletId],
      ];
      for (const [name, value] of required) {
        if (!value) {
          throw new Error(
            `${name} is required when BLOCKRADAR_SOLANA_NATIVE_ENABLED=true`,
          );
        }
      }
    }
    this.logger.log(
      `blockradar.init solana_native=${this.solanaNativeEnabled} refund_support=${this.refundSupported}`,
    );
  }

  get capabilities(): SettlementProviderCapabilities {
    return {
      provider: 'blockradar',
      currencies: ['NGN'],
      refundSupport: this.refundSupported,
      settlementLatency: 'deferred',
    };
  }

  /**
   * Provision a Blockradar-managed Solana child address under Xend's master
   * wallet, with auto-sweep configured. The endpoint is Blockradar-managed;
   * Xend never holds the funds. Attribution derives from the master wallet.
   */
  async provision(params: {
    merchantId: string;
    merchantAddress?: string;
  }): Promise<ProvisionedSettlementEndpoint> {
    const created = await this.blockradarFetch<{
      data: { id: string; address: string };
    }>(`/wallets/${encodeURIComponent(this.masterWalletId)}/addresses`, {
      method: 'POST',
      body: JSON.stringify({
        name: `merchant_${params.merchantId}`,
        metadata: { merchantId: params.merchantId },
        enableAutoSweep: true,
      }),
    });
    return {
      address: created.data.address,
      providerReference: created.data.id,
      attributionRef: this.masterWalletId,
      payoutConfig: JSON.stringify({ masterWalletId: this.masterWalletId }),
    };
  }

  /**
   * Handle an incoming USDC settlement at a Merchant's child address. Deferred:
   * kicks off convert-and-payout and returns { status: 'pending' } — naira
   * lands asynchronously and the webhook drives completion via Phase 4's
   * completeDeferredSettlement. Idempotent per signature: the partial-unique
   * settlement_offramps_signature_idx makes a re-invocation a no-op so the
   * convert-payout cannot double-fire.
   */
  async handleIncomingSettlement(params: {
    endpointAddress: string;
    signature: string;
    amountRaw: string;
  }): Promise<SettlementCompletion> {
    const account = await this.resolveAccount(params.endpointAddress);
    const merchantId = account.merchantId;

    // Validate BEFORE claiming the signature so a KYB/destination failure is
    // retryable once fixed (no orphaned claim row that would no-op forever).
    await this.assertMerchantKyb(merchantId);
    this.assertDestinationVerified(account.payoutConfig, merchantId);

    const paymentId = await this.resolvePaymentId(params.signature);

    // Claim the signature. A 23505 means a concurrent/replayed invocation
    // already claimed it (poll/webhook/cron race) -> no-op, no second payout.
    let offramp: { id: string };
    try {
      const [row] = await this.db.client
        .insert(settlementOfframps)
        .values({
          merchantId,
          paymentId,
          provider: 'blockradar',
          signature: params.signature,
          // The off-ramp is keyed to the settlement signature; Blockradar
          // echoes it in offramp.* webhooks so the receiver correlates by it.
          providerRef: params.signature,
          direction: 'settlement',
          usdcAmountRaw: params.amountRaw,
          status: 'pending',
        })
        .returning({ id: settlementOfframps.id });
      offramp = row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        this.logger.log(
          `blockradar.settlement.noop signature=${params.signature}`,
        );
        return { status: 'pending' };
      }
      throw err;
    }

    // Kick off the convert+payout. The Solana-native off-ramp is UNCONFIRMED
    // (ADR 0019), so this network call is gated OFF by default; the row stays
    // pending until the webhook reports naira landed. The side effect is keyed
    // on the signature so the DB guard and the provider request agree.
    if (this.solanaNativeEnabled) {
      await this.blockradarFetch(`/wallets/withdraw-fiat`, {
        method: 'POST',
        body: JSON.stringify({
          reference: params.signature,
          address: params.endpointAddress,
          amountRaw: params.amountRaw,
        }),
      });
    }

    await this.events.publish({
      topic: 'payout.initiated',
      key: offramp.id,
      payload: {
        offrampId: offramp.id,
        merchantId,
        paymentId,
        usdcAmountRaw: params.amountRaw,
      },
      correlationId: offramp.id,
    });

    return { status: 'pending' };
  }

  /**
   * Reverse a naira settlement (refund): naira -> USDC to the Consumer at the
   * live rate, invoked by Phase 6's refund API (no merchant signer). Records a
   * 'reversing' off-ramp row. The reverse primitive is UNCONFIRMED (ADR 0019),
   * so the provider call is gated OFF by default and refundSupport advertises
   * false — Phase 6's capability gate keeps naira refunds at manual-ops.
   */
  async reverse(params: {
    endpointAddress: string;
    consumerAddress: string;
    amountRaw: string;
    paymentId: string;
  }): Promise<{ signature: string }> {
    const account = await this.resolveAccount(params.endpointAddress);
    let signature: string;
    if (this.solanaNativeEnabled) {
      const res = await this.blockradarFetch<{ data: { reference: string } }>(
        `/wallets/reverse-fiat`,
        {
          method: 'POST',
          body: JSON.stringify({
            paymentId: params.paymentId,
            destination: params.consumerAddress,
            amountRaw: params.amountRaw,
          }),
        },
      );
      signature = res.data.reference;
    } else {
      // Stubbed: no confirmed reverse primitive. The recorded row is the
      // durable intent; the reference is a deterministic placeholder.
      signature = `stub_reverse_${params.paymentId}`;
    }

    await this.db.client.insert(settlementOfframps).values({
      merchantId: account.merchantId,
      paymentId: params.paymentId,
      provider: 'blockradar',
      providerRef: signature,
      direction: 'reverse',
      usdcAmountRaw: params.amountRaw,
      status: 'reversing',
    });

    return { signature };
  }

  /** Reconciliation: balance + provider reference only (no realized FX spread). */
  async report(params: {
    endpointAddress: string;
  }): Promise<{ balanceRaw: string; providerReference: string }> {
    const account = await this.resolveAccount(params.endpointAddress);
    const providerReference = account.providerReference ?? '';
    if (!this.solanaNativeEnabled) {
      return { balanceRaw: '0', providerReference };
    }
    const res = await this.blockradarFetch<{ data: { balanceRaw: string } }>(
      `/wallets/${encodeURIComponent(this.masterWalletId)}/addresses/${encodeURIComponent(providerReference)}/balance`,
      { method: 'GET' },
    );
    return { balanceRaw: res.data.balanceRaw, providerReference };
  }

  /**
   * Verify the raw-body HMAC over exact bytes (HMAC-SHA512, the documented
   * x-blockradar-signature scheme, docs.blockradar.co). Throws 401 on mismatch.
   * Called by the webhook controller BEFORE any DB access.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): void {
    const expected = createHmac('sha512', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    const a = Buffer.from(expected, 'utf-8');
    const b = Buffer.from(signature ?? '', 'utf-8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new HttpException(
        'invalid webhook signature',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  /** Narrow a Blockradar webhook payload to an owned off-ramp event, else null. */
  parseWebhookEvent(payload: unknown): OfframpWebhookEvent | null {
    const body = payload as {
      event?: string;
      data?: {
        id?: string;
        reference?: string;
        amountMinor?: string;
        rate?: string;
        providerTxRef?: string;
        completedAt?: string;
      };
    };
    const event = body?.event;
    const data = body?.data;
    if (!event || !data) return null;
    const providerRef = data.reference ?? data.id;
    if (!providerRef) return null;

    let type: OfframpWebhookEvent['type'];
    if (event === 'offramp.success') type = 'paid';
    else if (event === 'offramp.processing') type = 'processing';
    else if (event === 'offramp.failed') type = 'failed';
    else return null;

    return {
      type,
      providerRef,
      ngnSettledMinor: data.amountMinor,
      fxRate: data.rate,
      providerTxRef: data.providerTxRef,
      completedAt: data.completedAt,
    };
  }

  // ── internals ────────────────────────────────────────────────────────

  private async resolveAccount(endpointAddress: string): Promise<{
    merchantId: string;
    providerReference: string | null;
    payoutConfig: string | null;
  }> {
    const [account] = await this.db.client
      .select({
        merchantId: settlementAccounts.merchantId,
        providerReference: settlementAccounts.providerReference,
        payoutConfig: settlementAccounts.payoutConfig,
      })
      .from(settlementAccounts)
      .where(eq(settlementAccounts.address, endpointAddress))
      .limit(1);
    if (!account) {
      throw new DestinationUnverifiedError(
        `no settlement account for endpoint ${endpointAddress}`,
      );
    }
    return account;
  }

  private async assertMerchantKyb(merchantId: string): Promise<void> {
    const [merchant] = await this.db.client
      .select({ kybStatus: merchants.kybStatus })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    if (!merchant || merchant.kybStatus !== 'verified') {
      throw new MerchantKybRequiredError(
        `merchant ${merchantId} is not KYB-verified`,
      );
    }
  }

  private assertDestinationVerified(
    payoutConfig: string | null,
    merchantId: string,
  ): void {
    let verified = false;
    if (payoutConfig) {
      try {
        verified =
          (JSON.parse(payoutConfig) as { verified?: boolean }).verified ===
          true;
      } catch {
        verified = false;
      }
    }
    if (!verified) {
      throw new DestinationUnverifiedError(
        `bank destination for merchant ${merchantId} is not provider-verified`,
      );
    }
  }

  private async resolvePaymentId(signature: string): Promise<string | null> {
    const [attempt] = await this.db.client
      .select({ intentId: paymentAttempts.intentId })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.txSignature, signature))
      .limit(1);
    if (!attempt) return null;
    const [payment] = await this.db.client
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.intentId, attempt.intentId))
      .limit(1);
    return payment?.id ?? null;
  }

  private async blockradarFetch<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const res = await fetch(`${BLOCKRADAR_API_BASE}${path}`, {
      ...init,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`blockradar ${path} failed status=${res.status} ${body}`);
    }
    return (await res.json()) as T;
  }
}
