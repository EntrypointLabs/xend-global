import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
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
  SettlementBankAccount,
  SettlementCompletion,
  SettlementProvider,
  SettlementProviderCapabilities,
} from '../../settlement-provider.interface';
import {
  RefundNotSupportedError,
  SettlementAccountNotProvisionedError,
} from '../../settlement.errors';
import {
  DestinationUnverifiedError,
  MerchantKybRequiredError,
} from '../blockradar/settlement-offramp.errors';
import { DirectUsdcProvider } from '../direct-usdc.provider';
import { PajClient, PajRequestError, type PajBank } from './paj.client';

export const PAJ_PROVIDER = 'paj';
const BANK_LIST_TTL_MS = 60 * 60 * 1000;

/** The bank account could not be confirmed with the bank. */
export class BankAccountUnconfirmedError extends Error {
  constructor() {
    super('That bank account could not be confirmed');
    this.name = 'BankAccountUnconfirmedError';
  }
}

export interface ConfirmedBankAccount {
  accountName: string;
  bankName: string;
  accountLast4: string;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

const WebhookSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  transactionType: z.string(),
  signature: z.string().min(1),
  fiatAmount: z.number().nonnegative().optional(),
  rate: z.number().positive().optional(),
});

export interface PajOfframpEvent {
  eventId: string;
  type: 'paid' | 'processing' | 'failed';
  /** The Solana signature of the USDC transfer PAJ is paying out. */
  depositSignature: string;
  providerTxRef: string;
  ngnSettledMinor?: string;
  fxRate?: string;
}

/**
 * Naira settlement through PAJ. A Merchant's bank account is registered once
 * and PAJ returns a permanent Solana address for it: any USDC that lands
 * there is converted and paid to that bank account, so the Payment itself is
 * the payout instruction and nothing is called per settlement. Prydd never
 * holds the funds.
 *
 * PAJ has no reversal, so naira refunds stay unsupported.
 */
@Injectable()
export class PajSettlementProvider implements SettlementProvider {
  private readonly logger = new Logger(PajSettlementProvider.name);
  private banks: { at: number; list: PajBank[] } | null = null;

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly paj: PajClient,
    private readonly directUsdc: DirectUsdcProvider,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  /**
   * Advertises NGN only while enabled, which is what makes the router skip
   * this adapter and fall through to the next naira provider when it is off.
   */
  get capabilities(): SettlementProviderCapabilities {
    return {
      provider: PAJ_PROVIDER,
      currencies: this.enabled ? ['NGN'] : [],
      refundSupport: false,
      settlementLatency: 'deferred',
    };
  }

  get enabled(): boolean {
    return this.config.get<boolean>('PAJ_ENABLED') === true;
  }

  async listBanks(): Promise<PajBank[]> {
    if (!this.banks || Date.now() - this.banks.at > BANK_LIST_TTL_MS) {
      const list = await this.paj.getBanks();
      this.banks = {
        at: Date.now(),
        list: list
          .map((bank) => ({ code: bank.code, name: bank.name.trim() }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
    return this.banks.list;
  }

  /**
   * Looks the account up with the bank so its holder's name can be shown
   * before any money is pointed at it. PAJ has no lookup-only call, so this
   * registers the account; registration is idempotent and moves nothing.
   */
  async confirmBankAccount(
    bankAccount: SettlementBankAccount,
  ): Promise<ConfirmedBankAccount> {
    try {
      const registered = await this.paj.registerBankAccount(bankAccount);
      return {
        accountName: registered.accountName,
        bankName: registered.bank,
        accountLast4: registered.accountNumber.slice(-4),
      };
    } catch (err) {
      if (err instanceof PajRequestError && err.status === 400) {
        throw new BankAccountUnconfirmedError();
      }
      throw err;
    }
  }

  async provision(params: {
    merchantId: string;
    bankAccount?: SettlementBankAccount;
  }): Promise<ProvisionedSettlementEndpoint> {
    if (!params.bankAccount) {
      throw new SettlementAccountNotProvisionedError(
        'A bank account is required for naira settlement',
      );
    }
    const registered = await this.paj.registerBankAccount(params.bankAccount);

    // PAJ's address is a wallet, and a Payment credits a token account. Its
    // USDC associated account is the one PAJ watches; creating it up front
    // keeps the first Payment from failing on a missing destination.
    const tokenAccount = await this.directUsdc.provision({
      merchantId: params.merchantId,
      merchantAddress: registered.address,
    });

    return {
      address: tokenAccount.address,
      providerReference: registered.address,
      attributionRef: null,
      payoutConfig: JSON.stringify({
        pajBankAccountId: registered.id,
        bankCode: params.bankAccount.bankCode,
        bankName: registered.bank,
        accountName: registered.accountName,
        accountLast4: registered.accountNumber.slice(-4),
        verified: true,
      }),
    };
  }

  /**
   * Records the payout PAJ has already started by observing the transfer.
   * Idempotent per signature through settlement_offramps_signature_idx.
   */
  async handleIncomingSettlement(params: {
    endpointAddress: string;
    signature: string;
    amountRaw: string;
  }): Promise<SettlementCompletion> {
    const account = await this.resolveAccount(params.endpointAddress);
    await this.assertMerchantKyb(account.merchantId);
    const paymentId = await this.resolvePaymentId(params.signature);

    let offrampId: string;
    try {
      const [row] = await this.db.client
        .insert(settlementOfframps)
        .values({
          merchantId: account.merchantId,
          paymentId,
          provider: PAJ_PROVIDER,
          signature: params.signature,
          // PAJ echoes the transfer's signature on its webhooks, so the
          // receiver finds this row by it.
          providerRef: params.signature,
          direction: 'settlement',
          usdcAmountRaw: params.amountRaw,
          status: 'pending',
        })
        .returning({ id: settlementOfframps.id });
      offrampId = row.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        this.logger.log(`paj.settlement.noop signature=${params.signature}`);
        return { status: 'pending' };
      }
      throw err;
    }

    await this.events.publish({
      topic: 'payout.initiated',
      key: offrampId,
      payload: {
        offrampId,
        merchantId: account.merchantId,
        paymentId,
        usdcAmountRaw: params.amountRaw,
      },
      correlationId: offrampId,
    });
    return { status: 'pending' };
  }

  reverse(): Promise<{ signature: string }> {
    return Promise.reject(
      new RefundNotSupportedError('PAJ settlements cannot be reversed'),
    );
  }

  /** PAJ sweeps a deposit within seconds, so the endpoint holds no balance. */
  async report(params: {
    endpointAddress: string;
  }): Promise<{ balanceRaw: string; providerReference: string }> {
    const account = await this.resolveAccount(params.endpointAddress);
    return {
      balanceRaw: '0',
      providerReference: account.providerReference ?? '',
    };
  }

  /** Narrows a PAJ delivery to an off-ramp status change, else null. */
  parseWebhookEvent(payload: unknown): PajOfframpEvent | null {
    const parsed = WebhookSchema.safeParse(payload);
    if (!parsed.success || parsed.data.transactionType !== 'OFF_RAMP') {
      return null;
    }
    const { id, status, signature, fiatAmount, rate } = parsed.data;
    const type = (
      {
        COMPLETED: 'paid',
        PROCESSING: 'processing',
        PAID: 'processing',
        ERROR: 'failed',
        FAILED: 'failed',
      } as const
    )[status];
    if (!type) return null;
    return {
      type,
      eventId: `${id}:${status}`,
      depositSignature: signature,
      providerTxRef: id,
      ngnSettledMinor:
        fiatAmount === undefined
          ? undefined
          : String(Math.round(fiatAmount * 100)),
      fxRate: rate === undefined ? undefined : String(rate),
    };
  }

  private async resolveAccount(endpointAddress: string): Promise<{
    merchantId: string;
    providerReference: string | null;
  }> {
    const executionCluster = this.config.getOrThrow<string>('SOLANA_CLUSTER');
    const [account] = await this.db.client
      .select({
        merchantId: settlementAccounts.merchantId,
        providerReference: settlementAccounts.providerReference,
      })
      .from(settlementAccounts)
      .where(
        and(
          eq(settlementAccounts.address, endpointAddress),
          eq(settlementAccounts.executionCluster, executionCluster),
        ),
      )
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
    if (merchant?.kybStatus !== 'verified') {
      throw new MerchantKybRequiredError(
        `merchant ${merchantId} is not KYB-verified`,
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
}
