import { Injectable, Logger } from '@nestjs/common';
import type {
  FiatProvider,
  FiatQuoteSide,
  FiatRoute,
  FiatStatus,
  ProviderFiatOrder,
  ProviderFiatOrderStatus,
  ProviderFiatQuote,
} from '../../fiat-provider.interface';
import { FiatError } from '../../fiat.errors';
import {
  decimalToMinorFloor,
  minorToDecimalString,
  parseDecimal,
  usdcForFiat,
  usdcToFiat,
} from '../../rate-math';
import { PaycrestClient, PaycrestRequestError } from './paycrest.client';

const ROUTE_ID = 'paycrest:usdc-ngn';
// /rates carries no quote id or expiry, so the preview carries our own.
const QUOTE_TTL_MS = 60_000;
const MIN_NAIRA_KOBO = 100_000n; // ₦1,000
// A first guess at the rate only picks Paycrest's amount bucket; the second
// call prices the real amount.
const BUCKET_GUESS_RATE = '1000';
// Paycrest adds its transaction fee to the deposit. A fee above the larger of
// these is refused rather than shown as a surprise; the flat floor keeps a
// fixed network fee from blocking small payouts.
const MAX_FEE_BPS = 500n;
const MAX_FEE_FLOOR_USDC = 500_000n;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type QuoteReference = { rate: string; providerIds: string[] };

/**
 * USDC out of the Consumer's Account, naira into any Nigerian bank account.
 * Paycrest opens a Solana deposit address per order; the Account pays it with
 * the ordinary signed transfer and Paycrest settles the bank leg.
 */
@Injectable()
export class PaycrestFiatProvider implements FiatProvider {
  readonly name = 'paycrest';
  private readonly logger = new Logger(PaycrestFiatProvider.name);

  constructor(private readonly paycrest: PaycrestClient) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async routes(): Promise<FiatRoute[]> {
    if (!this.paycrest.configured()) return [];
    return [
      {
        id: ROUTE_ID,
        provider: this.name,
        direction: 'send',
        environment: 'production',
        sourceCurrency: 'USDC',
        destinationCurrency: 'NGN',
        network: 'solana',
        quoteAvailable: true,
        orderAvailable: true,
        accountKinds: [],
        holdsFiat: false,
        thirdPartyPayments: 'supported',
      },
    ];
  }

  async quote(
    route: FiatRoute,
    amountMinor: string,
    side: FiatQuoteSide = 'debit',
  ): Promise<ProviderFiatQuote> {
    if (route.id !== ROUTE_ID) {
      throw new FiatError('UNSUPPORTED_QUOTE', 'This route is unavailable.');
    }
    const amount = BigInt(amountMinor);
    let usdc: bigint;
    let naira: bigint;
    let priced: QuoteReference;
    if (side === 'credit') {
      if (amount < MIN_NAIRA_KOBO) throw tooSmall();
      const guess = usdcForFiat(amount, BUCKET_GUESS_RATE, 2);
      const first = await this.rate(guess);
      usdc = usdcForFiat(amount, first.rate, 2);
      priced = await this.rate(usdc);
      usdc = usdcForFiat(amount, priced.rate, 2);
      naira = amount;
    } else {
      usdc = amount;
      priced = await this.rate(usdc);
      naira = usdcToFiat(usdc, priced.rate, 2);
      if (naira < MIN_NAIRA_KOBO) throw tooSmall();
    }
    return {
      reference: JSON.stringify(priced),
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      debit: { currency: 'USDC', amountMinor: usdc.toString(), decimals: 6 },
      credit: { currency: 'NGN', amountMinor: naira.toString(), decimals: 2 },
      fees: [],
      fields: [
        { key: 'bankCode', label: 'Bank', type: 'text', required: true },
        {
          key: 'accountNumber',
          label: 'Account number',
          type: 'text',
          required: true,
        },
        { key: 'narration', label: 'Note', type: 'text', required: false },
      ],
      paymentStep: 'account_transfer',
    };
  }

  async createOrder(
    input: Parameters<FiatProvider['createOrder']>[0],
  ): Promise<ProviderFiatOrder> {
    const bankCode = input.fields.bankCode?.trim() ?? '';
    const accountNumber = input.fields.accountNumber?.trim() ?? '';
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) {
      throw new FiatError(
        'INVALID_FIELDS',
        'Enter a 10-digit account number and choose a bank.',
      );
    }
    if (!SOLANA_ADDRESS.test(input.destinationAddress)) {
      throw new FiatError(
        'ACCOUNT_NOT_READY',
        'Your Account is still being set up.',
        409,
      );
    }
    const priced = parseReference(input.quote.reference);
    const holder = await this.call(() =>
      this.paycrest.verifyAccount(bankCode, accountNumber),
    );
    if (!holder.found) {
      throw new FiatError(
        'ACCOUNT_NOT_FOUND',
        'That account number was not found at this bank.',
      );
    }
    const accountName = holder.accountName ?? 'Account holder';
    const usdc = BigInt(input.quote.debit.amountMinor);
    const created = await this.call(() =>
      this.paycrest.createOrder({
        usdc: minorToDecimalString(usdc, 6),
        rate: priced.rate,
        providerIds: priced.providerIds,
        reference: input.idempotencyKey,
        // Unpaid or failed payouts are returned to the Account itself.
        refundAddress: input.destinationAddress,
        institution: bankCode,
        accountNumber,
        accountName,
        memo: payoutNarration(input.fields.narration),
      }),
    );
    const account = created.providerAccount;
    const deposit = decimalToMinorFloor(account.amountToTransfer, 6);
    if (
      account.network !== 'solana' ||
      !SOLANA_ADDRESS.test(account.receiveAddress) ||
      deposit < usdc ||
      deposit - usdc > maxFee(usdc)
    ) {
      this.logger.error(
        `paycrest.order unusable funding order=${created.id} network=${account.network}`,
      );
      // No USDC has moved: the order just expires unfunded at Paycrest.
      throw new FiatError(
        'PROVIDER_RESPONSE_INVALID',
        'The payout could not be priced. Nothing was sent.',
        502,
      );
    }
    return {
      reference: created.id,
      status: 'awaiting_payment',
      instructions: {
        kind: 'crypto_transfer',
        message: 'Send this exact USDC from your Account to start the payout.',
        depositAddress: account.receiveAddress,
        depositAmount: {
          currency: 'USDC',
          amountMinor: deposit.toString(),
          decimals: 6,
        },
        payoutAccountName: accountName,
        expiresAt: account.validUntil,
      },
    };
  }

  async getOrder(reference: string): Promise<ProviderFiatOrderStatus | null> {
    const order = await this.call(() => this.paycrest.getOrder(reference));
    if (!order) return null;
    const status = paycrestStatus(order.status);
    if (!status) {
      this.logger.warn(`paycrest.order unknown status=${order.status}`);
      return null;
    }
    return {
      reference,
      status,
      ...(order.txHash ? { signature: order.txHash } : {}),
    };
  }

  private async rate(usdc: bigint): Promise<QuoteReference> {
    const priced = await this.call(() =>
      this.paycrest.sellRate(minorToDecimalString(usdc, 6)),
    );
    if (!priced) {
      throw new FiatError(
        'ROUTE_UNAVAILABLE',
        'Bank payouts are unavailable for this amount right now.',
        503,
      );
    }
    parseDecimal(priced.rate);
    return priced;
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof FiatError) throw error;
      if (
        error instanceof PaycrestRequestError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        this.logger.warn(error.message);
        throw new FiatError(
          'PROVIDER_REFUSED',
          'Our payout partner could not take this transfer. Nothing was sent.',
        );
      }
      throw error;
    }
  }
}

function maxFee(usdc: bigint): bigint {
  const share = (usdc * MAX_FEE_BPS) / 10_000n;
  return share > MAX_FEE_FLOOR_USDC ? share : MAX_FEE_FLOOR_USDC;
}

function tooSmall() {
  return new FiatError(
    'AMOUNT_OUT_OF_RANGE',
    'The smallest bank transfer is ₦1,000.',
  );
}

function parseReference(reference: string): QuoteReference {
  try {
    const value = JSON.parse(reference) as QuoteReference;
    if (typeof value.rate === 'string' && Array.isArray(value.providerIds)) {
      return value;
    }
  } catch {
    // fall through
  }
  throw new FiatError('QUOTE_EXPIRED', 'Get a new quote before continuing.');
}

/** Null for a status Paycrest has not documented; the order keeps its state. */
export function paycrestStatus(status: string): FiatStatus | null {
  switch (status) {
    case 'initiated':
      return 'awaiting_payment';
    case 'deposited':
    case 'pending':
    case 'fulfilling':
    case 'fulfilled':
      return 'processing';
    // Validated means the bank leg is paid; settling and settled are Paycrest
    // closing its own on-chain books afterwards.
    case 'validated':
    case 'settling':
    case 'settled':
      return 'completed';
    case 'refunding':
      return 'return_pending';
    case 'refunded':
      return 'returned';
    case 'expired':
      return 'expired';
    default:
      return null;
  }
}

/**
 * The narration on the recipient's bank alert. Nigerian banks cut it short and
 * reject unusual characters, so it is kept plain and brief.
 */
export function payoutNarration(note: string | undefined): string {
  const plain = (note ?? '')
    .replace(/[^A-Za-z0-9 .,'&()/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NARRATION_MAX)
    .trim();
  return plain || 'Prydd transfer';
}

const NARRATION_MAX = 60;
