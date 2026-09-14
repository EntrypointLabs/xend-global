import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { FiatError } from '../fiat.errors';
import { decimalToMinor, minorToDecimal } from '../fiat-money';
import type {
  FiatField,
  FiatMoney,
  FiatProvider,
  FiatRoute,
  ProviderFiatOrder,
  ProviderFiatQuote,
} from '../fiat-provider.interface';

const SANDBOX_URL = 'https://sandbox-api.fonbnk.com';
const SANDBOX_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const NGN = {
  paymentChannel: 'bank',
  currencyType: 'fiat',
  currencyCode: 'NGN',
  countryIsoCode: 'NG',
};
const USDC = {
  paymentChannel: 'crypto',
  currencyType: 'crypto',
  currencyCode: 'SOLANA_USDC',
};
type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse();
  return value as RecordValue;
}

function invalidResponse(): FiatError {
  return new FiatError(
    'PROVIDER_INVALID_RESPONSE',
    'The provider returned an invalid quote or route.',
    502,
  );
}

/** Preserve every JSON numeric lexeme before JSON.parse can round it. */
function parseExactJson(text: string): unknown {
  if (text.length > 1_000_000) throw invalidResponse();
  return JSON.parse(
    text.replace(
      /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (token) => (token.startsWith('"') ? token : JSON.stringify(token)),
    ),
  ) as unknown;
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw invalidResponse();
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw invalidResponse();
  const exponent = Number(match[3] ?? '0');
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100)
    throw invalidResponse();
  const digits = match[1] + (match[2] ?? '');
  const point = match[1].length + exponent;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function money(currency: 'NGN' | 'USDC', value: unknown): FiatMoney {
  const decimals = currency === 'NGN' ? 2 : 6;
  return {
    currency,
    decimals,
    amountMinor: decimalToMinor(decimal(value), decimals),
  };
}

@Injectable()
export class FonbnkFiatProvider implements FiatProvider {
  readonly name = 'fonbnk';

  constructor(private readonly config: ConfigService) {}

  async routes(): Promise<FiatRoute[]> {
    if (!this.enabled()) return [];
    const response = await this.request('/api/v2/currencies');
    return this.discoveredRoutes(response);
  }

  async quote(
    route: FiatRoute,
    amountMinor: string,
  ): Promise<ProviderFiatQuote> {
    if (!this.enabled())
      throw new FiatError(
        'PROVIDER_CAPABILITY_UNAVAILABLE',
        'Fonbnk sandbox quotes are not enabled.',
        503,
      );
    if (!/^\d{1,30}$/.test(amountMinor) || BigInt(amountMinor) <= 0n) {
      throw new FiatError('INVALID_AMOUNT', 'Enter a positive amount.');
    }
    const available = (await this.routes()).find(
      (candidate) => candidate.id === route.id,
    );
    if (
      !available ||
      !available.quoteAvailable ||
      route.provider !== this.name ||
      route.environment !== 'sandbox' ||
      route.direction !== available.direction ||
      route.sourceCurrency !== available.sourceCurrency ||
      route.destinationCurrency !== available.destinationCurrency ||
      route.network !== 'solana'
    ) {
      throw new FiatError(
        'ROUTE_UNAVAILABLE',
        'This sandbox route is unavailable.',
      );
    }
    const source = available.direction === 'receive' ? NGN : USDC;
    const destination = available.direction === 'receive' ? USDC : NGN;
    const query = new URLSearchParams();
    for (const [side, leg] of [
      ['deposit', source],
      ['payout', destination],
    ] as const) {
      for (const [key, value] of Object.entries(leg)) {
        query.set(`${side}${key[0].toUpperCase()}${key.slice(1)}`, value);
      }
    }
    const limits = record(
      await this.request(`/api/v2/order-limits?${query.toString()}`),
    );
    try {
      this.validateLimits(
        record(limits.deposit),
        available.sourceCurrency,
        amountMinor,
      );
      this.validateLimits(record(limits.payout), available.destinationCurrency);
    } catch (error) {
      if (error instanceof FiatError) throw error;
      throw invalidResponse();
    }
    const amount = minorToDecimal(
      amountMinor,
      available.sourceCurrency === 'NGN' ? 2 : 6,
    );
    // Provider requires a JSON number. The validated decimal is written directly,
    // avoiding conversion through binary floating point in either direction.
    const body = `{"deposit":{${JSON.stringify(source).slice(1, -1)},"amount":${amount}},"payout":${JSON.stringify(destination)}}`;
    const response = await this.request('/api/v2/quote', body);
    try {
      return this.normalizeQuote(record(response), available, amountMinor);
    } catch (error) {
      if (error instanceof FiatError) throw error;
      throw invalidResponse();
    }
  }

  createOrder(
    input: Parameters<FiatProvider['createOrder']>[0],
  ): Promise<ProviderFiatOrder> {
    void input;
    return Promise.reject(this.executionUnavailable());
  }

  getOrder(reference: string): Promise<ProviderFiatOrder> {
    void reference;
    return Promise.reject(this.executionUnavailable());
  }

  private executionUnavailable(): FiatError {
    return new FiatError(
      'PROVIDER_CAPABILITY_UNAVAILABLE',
      'Fonbnk order execution has not been enabled or verified.',
      503,
    );
  }

  private enabled(): boolean {
    return (
      this.config.get<string>('FONBNK_ENV') === 'sandbox' &&
      !!this.config.get<string>('FONBNK_CLIENT_ID') &&
      !!this.config.get<string>('FONBNK_CLIENT_SECRET')
    );
  }

  private async request(endpoint: string, body?: string): Promise<unknown> {
    const timestamp = Date.now().toString();
    const secret = this.config.getOrThrow<string>('FONBNK_CLIENT_SECRET');
    const signature = createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(`${timestamp}:${endpoint}`)
      .digest('base64');
    try {
      const response = await fetch(`${SANDBOX_URL}${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': this.config.getOrThrow<string>('FONBNK_CLIENT_ID'),
          'x-timestamp': timestamp,
          'x-signature': signature,
        },
        ...(body === undefined ? {} : { body }),
      });
      if (!response.ok) {
        const code =
          response.status === 403
            ? 'PROVIDER_CAPABILITY_UNAVAILABLE'
            : 'PROVIDER_UNAVAILABLE';
        throw new FiatError(
          code,
          'The provider could not serve this sandbox request.',
          503,
        );
      }
      return parseExactJson(await response.text());
    } catch (error) {
      if (error instanceof FiatError) throw error;
      // Provider bodies, URLs and transport errors may contain sensitive details.
      throw new FiatError(
        'PROVIDER_UNAVAILABLE',
        'The provider could not serve this sandbox request.',
        503,
      );
    }
  }

  private discoveredRoutes(response: unknown): FiatRoute[] {
    if (!Array.isArray(response)) throw invalidResponse();
    const currencies = response.map((item: unknown) => record(item));
    const fiat = currencies.filter((item) => item.currencyCode === 'NGN');
    const crypto = currencies.filter(
      (item) => item.currencyCode === 'SOLANA_USDC',
    );
    if (!fiat.length || !crypto.length) return [];
    if (fiat.length !== 1 || crypto.length !== 1) throw invalidResponse();
    this.validateLeg({ ...fiat[0], paymentChannel: 'bank' }, 'NGN');
    this.validateLeg({ ...crypto[0], paymentChannel: 'crypto' }, 'USDC');
    if (
      !Array.isArray(fiat[0].paymentChannels) ||
      !Array.isArray(crypto[0].paymentChannels)
    )
      throw invalidResponse();
    const banks = fiat[0].paymentChannels
      .map((item: unknown) => record(item))
      .filter((item) => item.type === 'bank');
    const chains = crypto[0].paymentChannels
      .map((item: unknown) => record(item))
      .filter((item) => item.type === 'crypto');
    if (!banks.length || !chains.length) return [];
    if (banks.length !== 1 || chains.length !== 1) throw invalidResponse();
    return (['receive', 'send'] as const).map((direction) => ({
      id: `fonbnk:${direction}`,
      provider: this.name,
      direction,
      environment: 'sandbox',
      sourceCurrency: direction === 'receive' ? 'NGN' : 'USDC',
      destinationCurrency: direction === 'receive' ? 'USDC' : 'NGN',
      network: 'solana',
      quoteAvailable:
        direction === 'receive'
          ? banks[0].isDepositAllowed === true &&
            chains[0].isPayoutAllowed === true
          : chains[0].isDepositAllowed === true &&
            banks[0].isPayoutAllowed === true,
      orderAvailable: false,
      accountKinds: [],
      holdsFiat: false,
      thirdPartyPayments: 'unknown',
    }));
  }

  private normalizeQuote(
    response: RecordValue,
    route: FiatRoute,
    amountMinor: string,
  ): ProviderFiatQuote {
    const deposit = record(response.deposit);
    const payout = record(response.payout);
    this.validateLeg(deposit, route.sourceCurrency);
    this.validateLeg(payout, route.destinationCurrency);
    const depositCashout = record(deposit.cashout);
    const payoutCashout = record(payout.cashout);
    const debit = money(route.sourceCurrency, depositCashout.amountBeforeFees);
    const credit = money(
      route.destinationCurrency,
      payoutCashout.amountAfterFees,
    );
    if (
      debit.amountMinor !== BigInt(amountMinor).toString() ||
      BigInt(credit.amountMinor) <= 0n
    )
      throw invalidResponse();
    if (
      typeof response.quoteId !== 'string' ||
      !response.quoteId ||
      response.quoteId.length > 200 ||
      typeof response.quoteExpiresAt !== 'string' ||
      !Number.isFinite(Date.parse(response.quoteExpiresAt)) ||
      Date.parse(response.quoteExpiresAt) <= Date.now()
    )
      throw invalidResponse();
    const transferType = deposit.transferType;
    if (transferType !== 'manual' && transferType !== 'redirect')
      throw invalidResponse();
    return {
      reference: response.quoteId,
      expiresAt: new Date(response.quoteExpiresAt).toISOString(),
      debit,
      credit,
      fees: [
        money(route.sourceCurrency, depositCashout.totalChargedFees),
        money(route.destinationCurrency, payoutCashout.totalChargedFees),
      ],
      fields: this.fields(
        deposit.fieldsToCreateOrder,
        payout.fieldsToCreateOrder,
      ),
      paymentStep: transferType === 'manual' ? 'manual_transfer' : 'redirect',
    };
  }

  private validateLimits(
    limits: RecordValue,
    currency: 'NGN' | 'USDC',
    amountMinor?: string,
  ): void {
    const min = BigInt(money(currency, limits.min).amountMinor);
    const max = BigInt(money(currency, limits.max).amountMinor);
    const step = BigInt(money(currency, limits.step).amountMinor);
    if (min < 0n || max <= 0n || max < min || step <= 0n) {
      throw new FiatError(
        'ROUTE_UNAVAILABLE',
        'This sandbox route is unavailable.',
      );
    }
    if (amountMinor !== undefined) {
      const amount = BigInt(amountMinor);
      if (amount < min || amount > max || amount % step !== 0n) {
        throw new FiatError(
          'INVALID_AMOUNT',
          'The amount is outside the provider limits or step.',
        );
      }
    }
  }

  private validateLeg(leg: RecordValue, currency: 'NGN' | 'USDC'): void {
    const expected = currency === 'NGN' ? NGN : USDC;
    if (
      leg.currencyCode !== expected.currencyCode ||
      leg.currencyType !== expected.currencyType ||
      leg.paymentChannel !== expected.paymentChannel
    )
      throw invalidResponse();
    const details = record(leg.currencyDetails);
    if (currency === 'USDC') {
      if (
        details.network !== 'SOLANA' ||
        details.asset !== 'USDC' ||
        details.contractAddress !== SANDBOX_MINT
      )
        throw invalidResponse();
    } else if (details.countryIsoCode !== 'NG') throw invalidResponse();
  }

  private fields(...legs: unknown[]): FiatField[] {
    const fields = new Map<string, FiatField>();
    for (const leg of legs) {
      if (!Array.isArray(leg)) throw invalidResponse();
      for (const entry of leg) {
        const field = record(entry);
        if (typeof field.key !== 'string') throw invalidResponse();
        if (
          !['phoneNumber', 'bankCode', 'bankAccountNumber'].includes(field.key)
        ) {
          // Wallet destination is resolved by Xend; sandbox controls are not a consumer form.
          if (
            field.required === true &&
            !['blockchainWalletAddress', 'blockchainMemo'].includes(
              field.key,
            ) &&
            !['depositSandboxForcedFlow', 'payoutSandboxForcedFlow'].includes(
              field.key,
            )
          )
            throw invalidResponse();
          continue;
        }
        if (
          typeof field.label !== 'string' ||
          typeof field.required !== 'boolean' ||
          !['string', 'phone', 'enum'].includes(String(field.type))
        )
          throw invalidResponse();
        const normalized: FiatField = {
          key: field.key,
          label: field.label,
          required: field.required,
          type: field.type === 'enum' ? 'select' : 'text',
        };
        if (field.type === 'enum') {
          if (!Array.isArray(field.options) || !field.options.length)
            throw invalidResponse();
          normalized.options = field.options.map((option: unknown) => {
            const item = record(option);
            if (
              typeof item.value !== 'string' ||
              typeof item.label !== 'string'
            )
              throw invalidResponse();
            return { value: item.value, label: item.label };
          });
        }
        const previous = fields.get(normalized.key);
        if (previous && JSON.stringify(previous) !== JSON.stringify(normalized))
          throw invalidResponse();
        fields.set(normalized.key, normalized);
      }
    }
    return [...fields.values()];
  }
}
