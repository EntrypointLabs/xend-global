import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { FiatError } from '../fiat.errors';
import { decimalToMinor, minorToDecimal } from '../fiat-money';
import type { ProviderFiatQuote } from '../fiat-provider.interface';

const HOST = 'https://sandbox-api.fonbnk.com';
export const FONBNK_DEVNET_USDC =
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const ngn = {
  paymentChannel: 'bank',
  currencyType: 'fiat',
  currencyCode: 'NGN',
  countryIsoCode: 'NG',
};
const usdc = {
  paymentChannel: 'crypto',
  currencyType: 'crypto',
  currencyCode: 'SOLANA_USDC',
};
const text = z.string().min(1).max(2000);
const reference = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const orderId = z.string().regex(/^[a-f0-9]{24}$/i);
const cashout = z.object({ amountBeforeFees: text, amountAfterFees: text });
const leg = z.object({
  paymentChannel: text,
  currencyType: text,
  currencyCode: text,
  currencyDetails: z.object({
    countryIsoCode: text.optional(),
    network: text.optional(),
    asset: text.optional(),
    contractAddress: text.optional(),
  }),
  cashout,
  providedFieldsToCreateOrder: z.record(z.string()),
  transaction: z
    .object({
      meta: z
        .object({
          transactionHash: text.optional(),
          toAddress: text.optional(),
        })
        .passthrough()
        .optional(),
    })
    .optional(),
});
const instructions = z.object({
  type: z.literal('manual'),
  instructionsText: text,
  warningText: text.optional(),
  transferDetails: z
    .array(
      z.object({
        id: text,
        label: text,
        value: z.string().max(2000).optional(),
      }),
    )
    .max(30),
  fieldsToConfirmOrder: z
    .array(
      z.object({ key: text, type: text, label: text, required: z.boolean() }),
    )
    .max(20),
});
const orderSchema = z.object({
  _id: orderId,
  userEmail: z.string().email(),
  countryIsoCode: z.literal('NG'),
  merchantOrderParams: reference,
  status: z.enum([
    'deposit_awaiting',
    'deposit_validating',
    'deposit_successful',
    'deposit_invalid',
    'deposit_canceled',
    'deposit_expired',
    'payout_pending',
    'payout_successful',
    'payout_failed',
    'refund_initiated',
    'refund_pending',
    'refund_successful',
    'refund_failed',
  ]),
  deposit: leg.extend({ transferInstructions: instructions }),
  payout: leg,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

/** Persist this with the intent BEFORE submitting. It is also the recovery lookup key. */
export interface FonbnkOrderBinding {
  orderParams: string;
  direction: 'receive' | 'send';
  quote: ProviderFiatQuote;
  /** Verified customer identity and observed IP, supplied by the authenticated application. */
  customer: { email: string; countryIsoCode: 'NG'; ip: string };
  /** Required quote fields. Bank fields refer to the sender for receive, recipient for send. */
  fields: Record<string, string>;
  /** Server-resolved receiving vault on receive; optional known sender vault on send. */
  vaultAddress?: string;
}
export interface FonbnkSandboxOrder {
  provider: 'fonbnk';
  environment: 'sandbox';
  evidence: 'provider_sandbox';
  reference: string;
  orderParams: string;
  providerStatus: z.infer<typeof orderSchema>['status'];
  /** Provider status is not independent proof that a bank/chain balance was credited. */
  terminal: boolean;
  deposit: { currency: 'NGN' | 'USDC'; amountMinor: string };
  payout: { currency: 'NGN' | 'USDC'; amountMinor: string };
  instructions: z.infer<typeof instructions>;
  funding?: {
    network: 'solana-devnet';
    mint: string;
    address: string;
    amountMinor: string;
  };
  payoutTransactionHash?: string;
  expiresAt: string;
}

function invalid(
  message = 'Fonbnk returned an order that does not match the reserved intent.',
): FiatError {
  return new FiatError('PROVIDER_INVALID_RESPONSE', message, 502);
}
function wallet(value: string): string {
  try {
    if (new PublicKey(value).toBase58() !== value) throw new Error();
  } catch {
    throw new FiatError(
      'INVALID_DESTINATION',
      'A valid Solana vault address is required.',
    );
  }
  return value;
}
function exactJson(value: string): unknown {
  if (value.length > 1_000_000) throw invalid();
  // Preserve provider numeric lexemes; no monetary amount passes through a JS number.
  return JSON.parse(
    value.replace(
      /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (token) => (token.startsWith('"') ? token : JSON.stringify(token)),
    ),
  ) as unknown;
}
function minor(value: string, decimals: number): string {
  // Money endpoints specify decimals. Fail closed on exponent or excess precision.
  try {
    return decimalToMinor(value, decimals);
  } catch {
    throw invalid();
  }
}

/**
 * Official v2 order lifecycle. No production host, local credits, or automatic money movement.
 * The caller owns durable submit-once claims. A timed-out create MUST be recovered by
 * findByReference; orderParams is searchable but is not documented as an idempotency key.
 * Source: https://docs.fonbnk.com/server-to-server/api-endpoints/create-order
 */
export class FonbnkSandboxOrders {
  constructor(private readonly config: ConfigService) {}

  async create(binding: FonbnkOrderBinding): Promise<FonbnkSandboxOrder> {
    this.validateBinding(binding);
    if (Date.parse(binding.quote.expiresAt) <= Date.now())
      throw new FiatError(
        'QUOTE_EXPIRED',
        'Refresh the conversion quote before sending.',
      );
    const deposit = binding.direction === 'receive' ? ngn : usdc;
    const payout = binding.direction === 'receive' ? usdc : ngn;
    const fields = this.creationFields(binding);
    const amount = minorToDecimal(
      binding.quote.debit.amountMinor,
      binding.direction === 'receive' ? 2 : 6,
    );
    const body = JSON.stringify({
      quoteId: binding.quote.reference,
      userEmail: binding.customer.email,
      userCountryIsoCode: binding.customer.countryIsoCode,
      userIp: binding.customer.ip,
      payout,
      fieldsToCreateOrder: fields,
      orderParams: binding.orderParams,
    });
    const wire = `${body.slice(0, -1)},"deposit":{${JSON.stringify(deposit).slice(1, -1)},"amount":${amount}}}`;
    const result = z
      .object({ quoteUsed: z.literal(true), order: z.unknown() })
      .safeParse(await this.request('/api/v2/order', wire));
    if (!result.success)
      throw invalid(
        'Fonbnk did not confirm use of the accepted quote. Reconcile the order before retrying.',
      );
    return this.normalize(result.data.order, binding);
  }

  async get(
    id: string,
    binding: FonbnkOrderBinding,
  ): Promise<FonbnkSandboxOrder> {
    this.validateBinding(binding);
    orderId.parse(id);
    const result = this.normalize(
      await this.request(
        `/api/v2/order?${new URLSearchParams({ orderId: id })}`,
      ),
      binding,
    );
    if (result.reference !== id) throw invalid();
    return result;
  }

  async findByReference(
    binding: FonbnkOrderBinding,
  ): Promise<FonbnkSandboxOrder | null> {
    this.validateBinding(binding);
    const result = await this.request(
      `/api/v2/order?${new URLSearchParams({ orderParams: binding.orderParams })}`,
      undefined,
      true,
    );
    return result === null ? null : this.normalize(result, binding);
  }

  /** Call after actual source funding. For devnet crypto supply the observed transaction signature. */
  async confirm(
    id: string,
    binding: FonbnkOrderBinding,
    fields: Record<string, string>,
  ): Promise<FonbnkSandboxOrder> {
    const before = await this.get(id, binding);
    // Confirm is not idempotent at Fonbnk. A replay after acceptance is a read only.
    if (before.providerStatus !== 'deposit_awaiting') return before;
    const required = before.instructions.fieldsToConfirmOrder;
    if (
      Object.keys(fields).some(
        (key) => !required.some((field) => field.key === key),
      ) ||
      required.some((field) => field.required && !fields[field.key])
    )
      throw new FiatError(
        'MISSING_FIELDS',
        'Supply the required funding confirmation fields.',
      );
    if (
      binding.direction === 'send' &&
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(
        fields.blockchainTransactionHash ?? '',
      )
    )
      throw new FiatError(
        'INVALID_TRANSACTION',
        'A Solana funding transaction signature is required.',
      );
    const result = this.normalize(
      await this.request(
        '/api/v2/order/confirm',
        JSON.stringify({ orderId: id, fieldsToConfirmOrder: fields }),
      ),
      binding,
    );
    if (result.reference !== id) throw invalid();
    return result;
  }

  private validateBinding(binding: FonbnkOrderBinding): void {
    this.enabled();
    reference.parse(binding.orderParams);
    z.string().email().parse(binding.customer.email);
    if (binding.customer.countryIsoCode !== 'NG' || !isIP(binding.customer.ip))
      throw new FiatError(
        'INVALID_CUSTOMER',
        'Use the verified customer country and observed IP.',
      );
    if (!['receive', 'send'].includes(binding.direction)) throw invalid();
    const source = binding.direction === 'receive' ? 'NGN' : 'USDC';
    const target = binding.direction === 'receive' ? 'USDC' : 'NGN';
    if (
      binding.quote.debit.currency !== source ||
      binding.quote.credit.currency !== target ||
      binding.quote.debit.decimals !== (source === 'NGN' ? 2 : 6) ||
      binding.quote.credit.decimals !== (target === 'NGN' ? 2 : 6) ||
      !/^\d{1,30}$/.test(binding.quote.debit.amountMinor) ||
      BigInt(binding.quote.debit.amountMinor) <= 0n ||
      !/^\d{1,30}$/.test(binding.quote.credit.amountMinor) ||
      BigInt(binding.quote.credit.amountMinor) <= 0n ||
      !Number.isFinite(Date.parse(binding.quote.expiresAt)) ||
      !binding.quote.reference
    )
      throw new FiatError(
        'INVALID_QUOTE',
        'A valid NGN/Solana USDC quote is required.',
      );
    this.creationFields(binding);
  }

  private creationFields(binding: FonbnkOrderBinding): Record<string, string> {
    const allowed = [
      'phoneNumber',
      'bankCode',
      'bankAccountNumber',
      'blockchainMemo',
    ];
    if (Object.keys(binding.fields).some((key) => !allowed.includes(key)))
      throw new FiatError('INVALID_FIELDS', 'Unsupported order fields.');
    const fields = { ...binding.fields };
    if (binding.vaultAddress)
      fields.blockchainWalletAddress = wallet(binding.vaultAddress);
    if (binding.direction === 'receive' && !fields.blockchainWalletAddress)
      throw new FiatError(
        'INVALID_DESTINATION',
        'A server-resolved receiving vault is required.',
      );
    for (const field of binding.quote.fields) {
      const value = fields[field.key];
      if (
        (field.required && !value) ||
        (value &&
          field.options &&
          !field.options.some((option) => option.value === value))
      )
        throw new FiatError(
          'MISSING_FIELDS',
          'Supply the fields required by the accepted quote.',
        );
    }
    return fields;
  }

  private normalize(
    raw: unknown,
    binding: FonbnkOrderBinding,
  ): FonbnkSandboxOrder {
    const parsed = orderSchema.safeParse(raw);
    if (!parsed.success) throw invalid();
    const order = parsed.data;
    if (
      order.userEmail !== binding.customer.email ||
      order.merchantOrderParams !== binding.orderParams
    )
      throw invalid();
    const source = binding.direction === 'receive' ? 'NGN' : 'USDC';
    const target = binding.direction === 'receive' ? 'USDC' : 'NGN';
    for (const [value, currency] of [
      [order.deposit, source],
      [order.payout, target],
    ] as const) {
      const expected = currency === 'NGN' ? ngn : usdc;
      if (
        value.currencyCode !== expected.currencyCode ||
        value.currencyType !== expected.currencyType ||
        value.paymentChannel !== expected.paymentChannel
      )
        throw invalid();
      if (
        currency === 'NGN'
          ? value.currencyDetails.countryIsoCode !== 'NG'
          : value.currencyDetails.network !== 'SOLANA' ||
            value.currencyDetails.asset !== 'USDC' ||
            value.currencyDetails.contractAddress !== FONBNK_DEVNET_USDC
      )
        throw invalid();
    }
    const debit = minor(
      order.deposit.cashout.amountBeforeFees,
      source === 'NGN' ? 2 : 6,
    );
    const credit = minor(
      order.payout.cashout.amountAfterFees,
      target === 'NGN' ? 2 : 6,
    );
    if (
      debit !== BigInt(binding.quote.debit.amountMinor).toString() ||
      credit !== BigInt(binding.quote.credit.amountMinor).toString()
    )
      throw invalid();
    const expectedFields = this.creationFields(binding);
    for (const [key, value] of Object.entries(expectedFields)) {
      const valueLeg = key.startsWith('blockchain')
        ? source === 'USDC'
          ? order.deposit
          : order.payout
        : source === 'NGN'
          ? order.deposit
          : order.payout;
      if (valueLeg.providedFieldsToCreateOrder[key] !== value) throw invalid();
    }
    const result: FonbnkSandboxOrder = {
      provider: 'fonbnk',
      environment: 'sandbox',
      evidence: 'provider_sandbox',
      reference: order._id,
      orderParams: order.merchantOrderParams,
      providerStatus: order.status,
      terminal:
        order.status === 'payout_successful' ||
        order.status === 'refund_successful',
      deposit: { currency: source, amountMinor: debit },
      payout: { currency: target, amountMinor: credit },
      instructions: order.deposit.transferInstructions,
      expiresAt: order.expiresAt,
      payoutTransactionHash: order.payout.transaction?.meta?.transactionHash,
    };
    const details = new Map<string, string>();
    for (const detail of result.instructions.transferDetails) {
      if (details.has(detail.id)) throw invalid();
      details.set(detail.id, detail.value ?? '');
    }
    if (
      minor(details.get('amountToSend') ?? '', source === 'NGN' ? 2 : 6) !==
      debit
    )
      throw invalid();
    if (source === 'USDC') {
      result.funding = {
        network: 'solana-devnet',
        mint: FONBNK_DEVNET_USDC,
        address: wallet(details.get('recipientWalletAddress') ?? ''),
        amountMinor: debit,
      };
    }
    return result;
  }

  private enabled(): void {
    if (
      this.config.get('NODE_ENV') === 'production' ||
      this.config.get('FONBNK_ENV') !== 'sandbox' ||
      !this.config.get('FONBNK_CLIENT_ID') ||
      !this.config.get('FONBNK_CLIENT_SECRET')
    )
      throw new FiatError(
        'PROVIDER_CAPABILITY_UNAVAILABLE',
        'Configured sandbox credentials are required.',
        503,
      );
  }

  private async request(
    path: string,
    body?: string,
    allowMissing = false,
  ): Promise<unknown> {
    this.enabled();
    const timestamp = String(Date.now());
    const signature = createHmac(
      'sha256',
      Buffer.from(
        this.config.getOrThrow<string>('FONBNK_CLIENT_SECRET'),
        'base64',
      ),
    )
      .update(`${timestamp}:${path}`)
      .digest('base64');
    try {
      const response = await fetch(HOST + path, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { body }),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': this.config.getOrThrow<string>('FONBNK_CLIENT_ID'),
          'x-timestamp': timestamp,
          'x-signature': signature,
        },
      });
      if (response.status === 404 && allowMissing) return null;
      if (response.status === 403)
        throw new FiatError(
          'FONBNK_PERMISSION_REQUIRED',
          'Fonbnk must enable the create-users permission for this sandbox account.',
          503,
        );
      if (!response.ok)
        throw new FiatError(
          'PROVIDER_UNAVAILABLE',
          'Fonbnk could not process the sandbox request. Reconcile before retrying.',
          503,
        );
      return exactJson(await response.text());
    } catch (error) {
      if (error instanceof FiatError) throw error;
      throw new FiatError(
        'PROVIDER_UNAVAILABLE',
        'Fonbnk request outcome is unknown. Reconcile by reference before retrying.',
        503,
      );
    }
  }
}
