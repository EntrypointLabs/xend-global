import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PajClient,
  PajRequestError,
  type PajTransaction,
} from '../../settlement/providers/paj/paj.client';
import type {
  FiatProvider,
  FiatQuoteSide,
  FiatRoute,
  FiatStatus,
  ProviderFiatOrder,
  ProviderFiatOrderStatus,
  ProviderFiatQuote,
} from '../fiat-provider.interface';
import { FiatError } from '../fiat.errors';
import { decimalToMinorFloor, fiatToUsdc, numberToDecimal } from '../rate-math';

const ROUTE_ID = 'paj:ngn-usdc';
// Rates are indicative and PAJ prices the order when it opens, so a quote is
// only a preview; it lives long enough to read and confirm.
const QUOTE_TTL_MS = 2 * 60_000;
const MIN_NAIRA = 100n;
// PAJ refuses larger single orders; the exact ceiling is theirs to change.
const MAX_NAIRA = 5_000_000n;
const DEFAULT_DEPOSIT_WINDOW_MINUTES = 30;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Naira in, USDC out, through a bank account PAJ opens for one order. PAJ
 * delivers the USDC straight to the Consumer's vault; Prydd never holds it.
 */
@Injectable()
export class PajFiatProvider implements FiatProvider {
  readonly name = 'paj';
  private readonly logger = new Logger(PajFiatProvider.name);

  constructor(
    private readonly paj: PajClient,
    private readonly config: ConfigService,
  ) {}

  private configured(): boolean {
    return Boolean(this.config.get<string>('PAJ_API_KEY'));
  }

  /**
   * How long the app shows the account. PAJ keeps it open for 72 hours, so a
   * transfer made after this still lands; the window only stops the app from
   * offering details whose rate has gone stale.
   */
  private depositWindowMs(): number {
    const minutes = Number(
      this.config.get('FIAT_DEPOSIT_WINDOW_MINUTES') ??
        DEFAULT_DEPOSIT_WINDOW_MINUTES,
    );
    return (
      (Number.isFinite(minutes) && minutes > 0
        ? minutes
        : DEFAULT_DEPOSIT_WINDOW_MINUTES) * 60_000
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async routes(): Promise<FiatRoute[]> {
    if (!this.configured()) return [];
    return [
      {
        id: ROUTE_ID,
        provider: this.name,
        direction: 'receive',
        environment: 'production',
        sourceCurrency: 'NGN',
        destinationCurrency: 'USDC',
        network: 'solana',
        quoteAvailable: true,
        orderAvailable: true,
        accountKinds: ['temporary'],
        holdsFiat: false,
        thirdPartyPayments: 'unknown',
      },
    ];
  }

  async quote(
    route: FiatRoute,
    amountMinor: string,
    side: FiatQuoteSide = 'debit',
  ): Promise<ProviderFiatQuote> {
    if (route.id !== ROUTE_ID || side !== 'debit') {
      throw new FiatError(
        'UNSUPPORTED_QUOTE',
        'Enter the naira amount you will send.',
      );
    }
    const kobo = BigInt(amountMinor);
    if (kobo % 100n !== 0n) {
      throw new FiatError('INVALID_AMOUNT', 'Use a whole naira amount.');
    }
    const naira = kobo / 100n;
    if (naira < MIN_NAIRA || naira > MAX_NAIRA) {
      throw new FiatError(
        'AMOUNT_OUT_OF_RANGE',
        `Send between ₦${MIN_NAIRA.toLocaleString('en-NG')} and ₦${MAX_NAIRA.toLocaleString('en-NG')}.`,
      );
    }
    const rates = await this.call(() => this.paj.getRates());
    const rate = numberToDecimal(rates.onRampRate.rate);
    const credit = fiatToUsdc(kobo, rate, 2);
    if (credit <= 0n) {
      throw new FiatError('INVALID_AMOUNT', 'Amount is too small.');
    }
    return {
      reference: `paj-rate-${rates.onRampRate.createdAt}`,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      debit: { currency: 'NGN', amountMinor, decimals: 2 },
      credit: { currency: 'USDC', amountMinor: credit.toString(), decimals: 6 },
      fees: [],
      fields: [],
      paymentStep: 'manual_transfer',
    };
  }

  async createOrder(
    input: Parameters<FiatProvider['createOrder']>[0],
  ): Promise<ProviderFiatOrder> {
    if (!SOLANA_ADDRESS.test(input.destinationAddress)) {
      throw new FiatError(
        'ACCOUNT_NOT_READY',
        'Your Account is still being set up.',
        409,
      );
    }
    const naira = Number(BigInt(input.quote.debit.amountMinor) / 100n);
    const placed = await this.call(() =>
      this.paj.createOnramp({
        fiatAmount: naira,
        recipient: input.destinationAddress,
        webhookURL: input.webhookUrl,
        customerId: input.customerId,
      }),
    );
    const accountNumber = placed.accountNumber?.trim() ?? '';
    // Incomplete bank details must never be shown: someone could pay into them.
    if (
      !/^\d{10}$/.test(accountNumber) ||
      !placed.bank?.trim() ||
      !placed.accountName?.trim() ||
      placed.fiatAmount == null
    ) {
      this.logger.error(`paj.onramp incomplete account order=${placed.id}`);
      throw new FiatError(
        'PROVIDER_RESPONSE_INVALID',
        'We could not set up your deposit. Nothing was charged.',
        502,
      );
    }
    const transferKobo = decimalToMinorFloor(
      numberToDecimal(placed.fiatAmount),
      2,
    );
    return {
      reference: placed.id,
      status: 'awaiting_payment',
      instructions: {
        kind: 'bank_transfer',
        message: 'Transfer this exact amount once, from any Nigerian bank.',
        accountNumber,
        bankName: placed.bank.trim(),
        accountName: placed.accountName.trim(),
        transferAmount: {
          currency: 'NGN',
          amountMinor: transferKobo.toString(),
          decimals: 2,
        },
        expiresAt: new Date(Date.now() + this.depositWindowMs()).toISOString(),
      },
    };
  }

  async getOrder(reference: string): Promise<ProviderFiatOrderStatus | null> {
    const transaction = await this.call(() =>
      this.paj.getTransaction(reference),
    );
    if (!transaction) return null;
    return {
      reference,
      status: pajStatus(transaction),
      ...(transaction.signature ? { signature: transaction.signature } : {}),
    };
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof FiatError) throw error;
      if (
        error instanceof PajRequestError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        this.logger.warn(`paj refused: ${error.message}`);
        throw new FiatError(
          error.status === 403 ? 'VERIFICATION_REQUIRED' : 'PROVIDER_REFUSED',
          error.status === 403
            ? 'Verify your identity to continue.'
            : 'Our naira partner could not take this deposit. Nothing was charged.',
          error.status === 403 ? 403 : 422,
        );
      }
      // A timeout or 5xx may have created the order; the service records that
      // as needs_attention instead of offering a second set of details.
      throw error;
    }
  }
}

/**
 * ERROR means PAJ took the naira but has not delivered the USDC; its support
 * resolves it and orders have landed after it, so it is not a failure.
 */
export function pajStatus(transaction: PajTransaction): FiatStatus {
  switch (transaction.status.toUpperCase()) {
    case 'INIT':
      return 'awaiting_payment';
    case 'PAID':
    case 'PROCESSING':
      return 'processing';
    case 'COMPLETED':
      return 'completed';
    case 'ERROR':
      return 'needs_attention';
    case 'FAILED':
    case 'CANCELLED':
      return 'failed';
    default:
      return 'needs_attention';
  }
}
