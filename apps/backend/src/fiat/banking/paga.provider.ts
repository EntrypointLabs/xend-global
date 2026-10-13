import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  BankAccount,
  BankAccountProvider,
  BankOperation,
  BankPayoutProvider,
  BankRecipient,
} from './banking-provider.interface';

export interface PagaConfig {
  environment: 'sandbox';
  publicKey: string;
  secretKey: string;
  hashKey: string;
}
export type PagaTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;
export class PagaError extends Error {
  constructor(
    readonly code:
      | 'CONFIGURATION'
      | 'INVALID_INPUT'
      | 'AUTHENTICATION'
      | 'REJECTED'
      | 'UNKNOWN_OUTCOME'
      | 'INVALID_RESPONSE',
  ) {
    super(`Paga ${code.toLowerCase()}`);
  }
}
const ref = z.string().regex(/^[A-Za-z0-9_-]{1,50}$/);
const account = z.string().regex(/^\d{10}$/);
const bank = z.string().uuid();
const text = z.string().trim().min(1).max(200);
const minor = z.string().regex(/^[1-9]\d{0,14}$/);
const object = z.record(z.unknown());
function decimal(value: string): string {
  const n = BigInt(minor.parse(value));
  return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`;
}
function toMinor(value: unknown): string {
  // Response JSON is parsed losslessly below, so numbers never pass through binary arithmetic.
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value))
    throw new PagaError('INVALID_RESPONSE');
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
function parse(raw: string): Record<string, unknown> {
  try {
    // Tokenize strings before numbers so digits inside JSON strings remain untouched.
    const exact = raw.replace(
      /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (token) => (token.startsWith('"') ? token : JSON.stringify(token)),
    );
    return object.parse(JSON.parse(exact));
  } catch {
    throw new PagaError('INVALID_RESPONSE');
  }
}
/** Sandbox-only. No callbacks authorize ledger entries; only reconciliation reads do. */
export class PagaProvider implements BankAccountProvider, BankPayoutProvider {
  readonly name = 'paga';
  constructor(
    private readonly config: PagaConfig,
    private readonly transport: PagaTransport = fetch,
  ) {
    if (
      config.environment !== 'sandbox' ||
      !config.publicKey ||
      !config.secretKey ||
      !config.hashKey
    )
      throw new PagaError('CONFIGURATION');
  }
  private hash(parts: string[]): string {
    return createHash('sha512')
      .update(parts.join('') + this.config.hashKey)
      .digest('hex');
  }
  private encode(
    kind: 'collect' | 'business',
    body: Record<string, unknown>,
  ): string {
    const encoded = JSON.stringify(body);
    // Collect demands a numeric amount. Keep its decimal lexeme identical to the signature.
    return kind === 'collect' &&
      typeof body.amount === 'string' &&
      /^\d+\.\d{2}$/.test(body.amount)
      ? encoded.replace(
          `"amount":${JSON.stringify(body.amount)}`,
          `"amount":${body.amount}`,
        )
      : encoded;
  }
  private async request(
    kind: 'collect' | 'business',
    path: string,
    body: Record<string, unknown> | undefined,
    parts: string[],
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      hash: this.hash(parts),
    };
    if (kind === 'collect')
      headers.Authorization = `Basic ${Buffer.from(`${this.config.publicKey}:${this.config.secretKey}`).toString('base64')}`;
    else {
      headers.principal = this.config.publicKey;
      headers.credentials = this.config.secretKey;
    }
    let response: Response;
    try {
      response = await this.transport(
        (kind === 'collect'
          ? 'https://beta-collect.paga.com'
          : 'https://beta.mypaga.com/paga-webservices/business-rest/secured') +
          path,
        {
          method: body ? 'POST' : 'GET',
          headers,
          body: body ? this.encode(kind, body) : undefined,
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new PagaError('UNKNOWN_OUTCOME');
    }
    if (response.status === 401 || response.status === 403)
      throw new PagaError('AUTHENTICATION');
    if (
      response.status >= 500 ||
      response.status === 408 ||
      response.status === 429
    )
      throw new PagaError('UNKNOWN_OUTCOME');
    if (!response.ok) throw new PagaError('REJECTED');
    let data: Record<string, unknown>;
    try {
      data = parse(await response.text());
    } catch {
      throw new PagaError('INVALID_RESPONSE');
    }
    if (
      String(data[kind === 'collect' ? 'statusCode' : 'responseCode']) !== '0'
    )
      throw new PagaError('REJECTED');
    return data;
  }
  private match(data: Record<string, unknown>, reference: string): void {
    if (data.referenceNumber !== reference)
      throw new PagaError('INVALID_RESPONSE');
  }
  async createAccount(
    input: Parameters<BankAccountProvider['createAccount']>[0],
  ): Promise<BankAccount> {
    const reference = ref.parse(input.reference);
    const accountReference = ref.min(12).max(30).parse(input.accountReference);
    const firstName = text.parse(input.firstName);
    const lastName = text.parse(input.lastName);
    const bvn =
      input.bvn === undefined
        ? ''
        : z
            .string()
            .regex(/^\d{11}$/)
            .parse(input.bvn);
    const accountName = `${firstName} ${lastName}`;
    const data = await this.request(
      'collect',
      '/subsidiary-accounts',
      {
        referenceNumber: reference,
        accountReference,
        firstName,
        lastName,
        accountName,
        email: z.string().email().parse(input.email),
        ...(bvn ? { iifiNumber: bvn } : {}),
        status: 'ACTIVE',
      },
      [reference, accountReference, bvn, '', '', '', ''],
    );
    this.match(data, reference);
    if (
      data.accountReference !== accountReference ||
      data.currency !== 'NGN' ||
      data.status !== 'ACTIVE' ||
      toMinor(data.balance) !== '0'
    )
      throw new PagaError('INVALID_RESPONSE');
    return {
      provider: this.name,
      reference: accountReference,
      accountNumber: account.parse(data.accountNumber),
      accountName,
      bankName: 'Paga',
      currency: 'NGN',
      custody: 'pooled',
    };
  }
  async getBalance(
    accountIdentifier: string,
    reference: string,
  ): Promise<{ amountMinor: string; currency: 'NGN'; observedAt: string }> {
    ref.parse(accountIdentifier);
    ref.parse(reference);
    const data = await this.request(
      'collect',
      `/subsidiary-accounts/${encodeURIComponent(accountIdentifier)}/balance?referenceNumber=${encodeURIComponent(reference)}`,
      undefined,
      [reference, accountIdentifier],
    );
    this.match(data, reference);
    if (
      (data.accountNumber !== accountIdentifier &&
        data.accountReference !== accountIdentifier) ||
      data.currency !== 'NGN'
    )
      throw new PagaError('INVALID_RESPONSE');
    const observedAt = z.string().parse(data.timeStamp);
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?$/.test(observedAt) ||
      !Number.isFinite(
        Date.parse(observedAt.endsWith('Z') ? observedAt : `${observedAt}Z`),
      )
    )
      throw new PagaError('INVALID_RESPONSE');
    return {
      amountMinor: toMinor(data.balance),
      currency: 'NGN',
      observedAt: observedAt.endsWith('Z') ? observedAt : `${observedAt}Z`,
    };
  }
  /** Read the provider-owned account before displaying a recipient confirmation. */
  async retrieveAccount(accountIdentifier: string, reference: string) {
    ref.parse(accountIdentifier);
    ref.parse(reference);
    const data = await this.request(
      'collect',
      `/subsidiary-accounts/${encodeURIComponent(accountIdentifier)}?referenceNumber=${encodeURIComponent(reference)}`,
      undefined,
      [reference, accountIdentifier],
    );
    this.match(data, reference);
    if (
      (data.accountNumber !== accountIdentifier &&
        data.accountReference !== accountIdentifier) ||
      data.currency !== 'NGN' ||
      data.status !== 'ACTIVE'
    )
      throw new PagaError('INVALID_RESPONSE');
    return {
      accountNumber: account.parse(data.accountNumber),
      accountReference: ref.parse(data.accountReference),
      accountName: text.parse(data.accountName),
      balanceMinor: toMinor(data.balance),
    };
  }

  /** Official sandbox account-to-account transfer; never routes through merchant treasury.
   * https://developer-docs.paga.com/docs/subsidiary-accounts section 6.
   * The matched synchronous result confirms the sandbox operation only.
   */
  async transferSubsidiary(input: {
    reference: string;
    sourceAccountIdentifier: string;
    destinationAccountIdentifier: string;
    amountMinor: string;
    narration: string;
  }) {
    ref.parse(input.reference);
    ref.parse(input.sourceAccountIdentifier);
    ref.parse(input.destinationAccountIdentifier);
    if (input.sourceAccountIdentifier === input.destinationAccountIdentifier)
      throw new PagaError('INVALID_INPUT');
    z.string().max(200).parse(input.narration);
    const amount = decimal(input.amountMinor);
    const data = await this.request(
      'collect',
      '/subsidiary-accounts/transfer',
      {
        referenceNumber: input.reference,
        sourceAccountIdentifier: input.sourceAccountIdentifier,
        destinationAccountIdentifier: input.destinationAccountIdentifier,
        amount,
        currency: 'NGN',
        narration: input.narration,
      },
      [
        input.reference,
        input.sourceAccountIdentifier,
        input.destinationAccountIdentifier,
        amount,
        'NGN',
        input.narration,
      ],
    );
    this.match(data, input.reference);
    const source = object.parse(data.source);
    const destination = object.parse(data.destination);
    if (
      source.accountIdentifier !== input.sourceAccountIdentifier ||
      destination.accountIdentifier !== input.destinationAccountIdentifier ||
      toMinor(source.amount) !== input.amountMinor ||
      toMinor(destination.amount) !== input.amountMinor
    )
      throw new PagaError('INVALID_RESPONSE');
    return {
      providerReference: text.parse(data.transactionId),
      sourceBalanceMinor: toMinor(source.newBalance),
      destinationBalanceMinor: toMinor(destination.newBalance),
      evidence: 'sandbox_response' as const,
    };
  }

  async banks(): Promise<{ code: string; name: string }[]> {
    const reference = randomUUID();
    const data = await this.request(
      'business',
      '/getBanks',
      { referenceNumber: reference },
      [reference],
    );
    this.match(data, reference);
    return z
      .array(z.object({ uuid: bank, name: text }))
      .parse(data.bank)
      .map((item) => ({ code: item.uuid, name: item.name }));
  }
  async resolveRecipient(
    bankCode: string,
    accountNumber: string,
  ): Promise<BankRecipient> {
    bank.parse(bankCode);
    account.parse(accountNumber);
    const reference = randomUUID();
    // This validation does not move money. Paga requires an amount even for name enquiry.
    const data = await this.request(
      'business',
      '/validateDepositToBank',
      {
        referenceNumber: reference,
        amount: '1.00',
        currency: 'NGN',
        destinationBankUUID: bankCode,
        destinationBankAccountNumber: accountNumber,
      },
      [reference, '1.00', bankCode, accountNumber],
    );
    this.match(data, reference);
    return {
      bankCode,
      accountNumber,
      accountName: text.parse(data.destinationAccountHolderNameAtBank),
    };
  }
  async submitPayout(
    input: Parameters<BankPayoutProvider['submitPayout']>[0],
  ): Promise<BankOperation> {
    ref.parse(input.reference);
    bank.parse(input.recipient.bankCode);
    account.parse(input.recipient.accountNumber);
    text.parse(input.recipient.accountName);
    const amount = decimal(input.amountMinor);
    const data = await this.request(
      'business',
      '/depositToBank',
      {
        referenceNumber: input.reference,
        amount,
        currency: 'NGN',
        destinationBankUUID: input.recipient.bankCode,
        destinationBankAccountNumber: input.recipient.accountNumber,
        remarks: z.string().max(200).parse(input.narration),
      },
      [
        input.reference,
        amount,
        input.recipient.bankCode,
        input.recipient.accountNumber,
      ],
    );
    this.match(data, input.reference);
    if (
      data.currency !== 'NGN' ||
      data.destinationAccountHolderNameAtBank !== input.recipient.accountName
    )
      throw new PagaError('INVALID_RESPONSE');
    return {
      provider: this.name,
      reference: input.reference,
      providerReference: text.parse(data.transactionId),
      status: 'pending',
      amountMinor: input.amountMinor,
      currency: 'NGN',
      evidence: 'fixture',
    };
  }
  async getPayout(
    input: Parameters<BankPayoutProvider['getPayout']>[0],
  ): Promise<BankOperation> {
    ref.parse(input.reference);
    text.parse(input.providerReference);
    minor.parse(input.amountMinor);
    bank.parse(input.recipient.bankCode);
    account.parse(input.recipient.accountNumber);
    const data = await this.request(
      'business',
      '/transactionStatus',
      { referenceNumber: input.reference },
      [input.reference],
    );
    this.match(data, input.reference);
    if (
      data.transactionId !== input.providerReference ||
      data.currency !== 'NGN' ||
      toMinor(data.amount) !== input.amountMinor
    )
      throw new PagaError('INVALID_RESPONSE');
    // Published status responses omit beneficiary fields. A complete match is required
    // even for a sandbox outcome; sandbox evidence can never settle a real ledger.
    const matched =
      data.destinationBankUUID === input.recipient.bankCode &&
      data.destinationBankAccountNumber === input.recipient.accountNumber;
    const status =
      data.status === 'SUCCESSFUL'
        ? 'succeeded'
        : data.status === 'FAILED'
          ? 'failed'
          : 'unknown';
    return {
      provider: this.name,
      reference: input.reference,
      providerReference: input.providerReference,
      amountMinor: input.amountMinor,
      currency: 'NGN',
      status: matched ? status : 'unknown',
      evidence: 'fixture',
    };
  }
  /** Separate treasury leg, never called automatically by submitPayout. */
  async charge(input: {
    reference: string;
    accountIdentifier: string;
    amountMinor: string;
    narration: string;
  }): Promise<BankOperation> {
    return this.moveSubsidiary('charge', input);
  }
  async topup(input: {
    reference: string;
    accountIdentifier: string;
    amountMinor: string;
    narration: string;
  }): Promise<BankOperation> {
    return this.moveSubsidiary('topup', input);
  }
  private async moveSubsidiary(
    operation: 'charge' | 'topup',
    input: {
      reference: string;
      accountIdentifier: string;
      amountMinor: string;
      narration: string;
    },
  ): Promise<BankOperation> {
    ref.parse(input.reference);
    ref.parse(input.accountIdentifier);
    z.string().max(200).parse(input.narration);
    const amount = decimal(input.amountMinor);
    // API specifies JSON number; bounded integer cents remain exact when encoded as decimal text.
    const body = {
      referenceNumber: input.reference,
      amount,
      currency: 'NGN',
      narration: input.narration,
    };
    const data = await this.request(
      'collect',
      `/subsidiary-accounts/${encodeURIComponent(input.accountIdentifier)}/${operation}`,
      body,
      [input.reference, amount, 'NGN', input.narration],
    );
    this.match(data, input.reference);
    toMinor(data.newBalance);
    return {
      provider: this.name,
      reference: input.reference,
      providerReference: text.parse(data.transactionId),
      amountMinor: input.amountMinor,
      currency: 'NGN',
      status: 'pending',
      evidence: 'fixture',
    };
  }
}
