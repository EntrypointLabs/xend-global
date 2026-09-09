import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  BankAccount,
  BankAccountProvider,
  BankOperation,
  BankPayoutProvider,
  BankRecipient,
} from './banking-provider.interface';

export interface NombaConfig {
  baseUrl?: string;
  accessToken?: string | (() => Promise<string>);
  onUnauthorized?: (token: string) => void;
  accountId?: string;
  senderName: string;
}
export type NombaTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;
export interface NombaIndicativeUsdQuote {
  debitNgnMinor: string;
  creditUsdMinor: string;
  observedAt: string;
  expiresAt: string;
  environment: 'sandbox';
  evidence: 'fixture';
}
export class NombaError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new NombaError('NOMBA_INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new NombaError('NOMBA_MISSING_FIELD');
  return value;
}
function minor(value: unknown): string {
  const input =
    typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof input !== 'string' || !/^\d+(\.\d{1,2})?$/.test(input))
    throw new NombaError('NOMBA_INVALID_AMOUNT');
  const [whole, fraction = ''] = input.split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new NombaError('NOMBA_INVALID_AMOUNT');
  return amount.toString();
}
function major(amount: string): number {
  if (!/^[1-9]\d*$/.test(amount)) throw new NombaError('NOMBA_INVALID_AMOUNT');
  const result = Number(
    `${BigInt(amount) / 100n}.${(BigInt(amount) % 100n).toString().padStart(2, '0')}`,
  );
  if (minor(result) !== amount) throw new NombaError('NOMBA_INVALID_AMOUNT');
  return result;
}
function recipient(value: BankRecipient): void {
  if (
    !/^\d{10}$/.test(value.accountNumber) ||
    !/^\d{3,6}$/.test(value.bankCode)
  )
    throw new NombaError('NOMBA_INVALID_RECIPIENT');
  text(value.accountName);
}

/** Sandbox contract adapter only. Even authenticated sandbox responses remain fixtures.
 * Durable idempotency/reservations belong in Xend's orchestrator. This adapter never retries writes.
 */
export class NombaAdapter implements BankAccountProvider, BankPayoutProvider {
  readonly name = 'nomba';
  private readonly baseUrl: string;
  constructor(
    private readonly config: NombaConfig,
    private readonly transport: NombaTransport = fetch,
  ) {
    this.baseUrl = config.baseUrl ?? 'https://sandbox.nomba.com';
    if (this.baseUrl !== 'https://sandbox.nomba.com')
      throw new NombaError('NOMBA_PRODUCTION_DISABLED');
    if (Boolean(config.accessToken) !== Boolean(config.accountId))
      throw new NombaError('NOMBA_INCOMPLETE_AUTH');
    text(config.senderName);
  }
  private async request(path: string, body?: unknown): Promise<unknown> {
    // Authenticate before entering the submission boundary. An auth failure cannot
    // make a bank write uncertain because no bank request has been sent yet.
    const accessToken =
      typeof this.config.accessToken === 'function'
        ? await this.config.accessToken()
        : this.config.accessToken;
    if (this.config.accessToken && (!accessToken || /\s/.test(accessToken)))
      throw new NombaError('NOMBA_AUTH_INVALID_RESPONSE');
    let response: Response;
    try {
      response = await this.transport(`${this.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken
            ? {
                Authorization: `Bearer ${accessToken}`,
                accountId: this.config.accountId!,
              }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new NombaError(
        body === undefined ? 'NOMBA_UNAVAILABLE' : 'NOMBA_SUBMISSION_UNCERTAIN',
      );
    }
    if (response.status === 401 && accessToken)
      this.config.onUnauthorized?.(accessToken);
    // Never refresh-and-retry a money mutation; its durable caller decides recovery.
    if (!response.ok)
      throw new NombaError(
        response.status >= 500 && body !== undefined
          ? 'NOMBA_SUBMISSION_UNCERTAIN'
          : 'NOMBA_REQUEST_REJECTED',
      );
    let payload: Record<string, unknown>;
    try {
      payload = object(await response.json());
    } catch {
      throw new NombaError(
        body === undefined
          ? 'NOMBA_INVALID_RESPONSE'
          : 'NOMBA_SUBMISSION_UNCERTAIN',
      );
    }
    if (String(payload.code) === '401' && accessToken)
      this.config.onUnauthorized?.(accessToken);
    if (!['00', '200', '201'].includes(String(payload.code)))
      throw new NombaError('NOMBA_REQUEST_REJECTED');
    return payload.data;
  }
  /** Quote-only API: https://developer.nomba.com/nomba-api-reference/global-payout/convert-money
   * This calculates USD fiat value; it neither authorizes an exchange nor quotes USDC settlement.
   * Sandbox values remain fixtures, including when authenticated.
   */
  async quoteNgnUsd(amountMinor: string): Promise<NombaIndicativeUsdQuote> {
    if (!this.config.accessToken || !this.config.accountId)
      throw new NombaError('NOMBA_AUTH_REQUIRED');
    const amount = major(amountMinor);
    const rateData = object(
      await this.request('/v1/global-payout/exchange-rates?from=NGN&to=USD'),
    );
    if (!Array.isArray(rateData.rates))
      throw new NombaError('NOMBA_INVALID_RATE');
    const rates = rateData.rates
      .map(object)
      .filter((rate) => rate.currencyPairName === 'NGN/USD');
    if (rates.length !== 1) throw new NombaError('NOMBA_INVALID_RATE');
    const rate = rates[0];
    const rateTime = Date.parse(text(rate.updatedAt || rate.createdAt));
    const rateExpiry = rateTime + 300_000;
    const now = Date.now();
    if (
      !Number.isFinite(rateTime) ||
      rateTime > now + 5_000 ||
      rateExpiry <= now
    )
      throw new NombaError('NOMBA_STALE_RATE');
    // A displayed currencyPairName alone does not establish numeric orientation.
    // Use explicit conversion amounts rather than interpreting the midpoint.
    const data = object(
      await this.request('/v1/global-payout/money/convert', {
        amount,
        currency: 'NGN',
        destinationCurrency: 'USD',
        transactionType: 'EXCHANGE',
      }),
    );
    if (
      data.fromCurrency !== 'NGN' ||
      data.toCurrency !== 'USD' ||
      minor(data.fromAmount) !== amountMinor
    )
      throw new NombaError('NOMBA_QUOTE_MISMATCH');
    const creditUsdMinor = minor(data.toAmount);
    if (BigInt(creditUsdMinor) <= 0n)
      throw new NombaError('NOMBA_INVALID_AMOUNT');
    text(data.exchangeRateId);
    const observed = Date.now();
    if (rateExpiry <= observed) throw new NombaError('NOMBA_STALE_RATE');
    return {
      debitNgnMinor: amountMinor,
      creditUsdMinor,
      observedAt: new Date(observed).toISOString(),
      expiresAt: new Date(
        Math.min(observed + 60_000, rateExpiry),
      ).toISOString(),
      environment: 'sandbox',
      evidence: 'fixture',
    };
  }
  async createAccount(
    input: Parameters<BankAccountProvider['createAccount']>[0],
  ): Promise<BankAccount> {
    text(input.reference);
    text(input.accountReference);
    if (input.bvn !== undefined && !/^\d{11}$/.test(input.bvn))
      throw new NombaError('NOMBA_INVALID_BVN');
    const data = object(
      await this.request('/v1/accounts/virtual', {
        accountRef: input.accountReference,
        accountName: `${text(input.firstName)} ${text(input.lastName)}`,
        currency: 'NGN',
        ...(input.bvn ? { bvn: input.bvn } : {}),
      }),
    );
    if (
      data.accountRef !== input.accountReference ||
      data.currency !== 'NGN' ||
      data.expired === true
    )
      throw new NombaError('NOMBA_ACCOUNT_MISMATCH');
    const accountNumber = text(data.bankAccountNumber);
    if (!/^\d{10}$/.test(accountNumber))
      throw new NombaError('NOMBA_ACCOUNT_MISMATCH');
    return {
      provider: this.name,
      reference: input.accountReference,
      accountNumber,
      accountName: text(data.bankAccountName),
      bankName: text(data.bankName),
      currency: 'NGN',
      custody: 'pooled',
    };
  }
  async banks(): Promise<{ code: string; name: string }[]> {
    const data = await this.request('/v1/transfers/bank');
    if (!Array.isArray(data)) throw new NombaError('NOMBA_INVALID_RESPONSE');
    return data.map((item: unknown) => {
      const row = object(item);
      return { code: text(row.code), name: text(row.name) };
    });
  }
  async resolveRecipient(
    bankCode: string,
    accountNumber: string,
  ): Promise<BankRecipient> {
    recipient({ bankCode, accountNumber, accountName: 'lookup' });
    const data = object(
      await this.request('/v1/transfers/bank/lookup', {
        bankCode,
        accountNumber,
      }),
    );
    if (data.accountNumber !== accountNumber)
      throw new NombaError('NOMBA_RECIPIENT_MISMATCH');
    return { bankCode, accountNumber, accountName: text(data.accountName) };
  }
  async submitPayout(
    input: Parameters<BankPayoutProvider['submitPayout']>[0],
  ): Promise<BankOperation> {
    recipient(input.recipient);
    text(input.reference);
    const data = object(
      await this.request('/v2/transfers/bank', {
        amount: major(input.amountMinor),
        ...input.recipient,
        merchantTxRef: input.reference,
        senderName: this.config.senderName,
        narration: input.narration,
      }),
    );
    // Acceptance without an ID cannot be safely retried: requery the durable merchant reference.
    if (!data.id) throw new NombaError('NOMBA_SUBMISSION_UNCERTAIN');
    return this.operation(data, input);
  }
  async getPayout(
    input: Parameters<BankPayoutProvider['getPayout']>[0],
  ): Promise<BankOperation> {
    recipient(input.recipient);
    text(input.reference);
    text(input.providerReference);
    major(input.amountMinor);
    const query = new URLSearchParams({
      transactionRef: input.providerReference,
      merchantTxRef: input.reference,
    });
    const data = object(
      await this.request(`/v1/transactions/accounts/single?${query}`),
    );
    if (data.id !== input.providerReference)
      throw new NombaError('NOMBA_TRANSACTION_MISMATCH');
    return this.operation(data, input);
  }
  private operation(
    data: Record<string, unknown>,
    input: { reference: string; amountMinor: string; recipient: BankRecipient },
  ): BankOperation {
    const meta = data.meta === undefined ? {} : object(data.meta);
    if (
      (data.merchantTxRef ?? meta.merchantTxRef) !== input.reference ||
      minor(data.amount) !== input.amountMinor ||
      data.type !== 'transfer'
    )
      throw new NombaError('NOMBA_TRANSACTION_MISMATCH');
    // These fields are documented on transfers. Missing fields cannot prove matching settlement.
    if (
      (data.currency ?? meta.currency) !== 'NGN' ||
      (meta.accountNumber ?? data.customerBillerId) !==
        input.recipient.accountNumber ||
      (meta.bankCode ?? data.productId) !== input.recipient.bankCode
    )
      throw new NombaError('NOMBA_TRANSACTION_MISMATCH');
    const statuses: Record<string, BankOperation['status']> = {
      SUCCESS: 'succeeded',
      PENDING_BILLING: 'pending',
      PENDING: 'pending',
      FAILED: 'failed',
      REFUND: 'refunded',
    };
    return {
      provider: this.name,
      reference: input.reference,
      providerReference: text(data.id),
      status: statuses[String(data.status)] ?? 'unknown',
      amountMinor: input.amountMinor,
      currency: 'NGN',
      evidence: 'fixture',
    };
  }
}

/** A verified notification only schedules authenticated requery; amount and beneficiary are NOT signed. */
export function verifyNombaWebhook(
  payload: unknown,
  headers: Record<string, string | undefined>,
  secret: string,
  now = Date.now(),
): boolean {
  try {
    if (
      !secret ||
      headers['nomba-signature-algorithm'] !== 'HmacSHA256' ||
      headers['nomba-signature-version'] !== '1.0.0'
    )
      return false;
    const timestamp = text(headers['nomba-timestamp']);
    const instant = Date.parse(timestamp);
    if (!Number.isFinite(instant) || Math.abs(now - instant) > 300000)
      return false;
    const row = object(payload),
      data = object(row.data),
      merchant = object(data.merchant),
      transaction = object(data.transaction);
    const responseCode =
      transaction.responseCode == null ||
      transaction.responseCode === 'null' ||
      transaction.responseCode === ''
        ? ''
        : text(transaction.responseCode);
    const signed = [
      text(row.event_type),
      text(row.requestId),
      text(merchant.userId),
      text(merchant.walletId),
      text(transaction.transactionId),
      text(transaction.type),
      text(transaction.time),
      responseCode,
      timestamp,
    ].join(':');
    const expected = createHmac('sha256', secret)
      .update(signed)
      .digest('base64');
    const actual = text(headers['nomba-signature']);
    return (
      actual.length === expected.length &&
      timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}
