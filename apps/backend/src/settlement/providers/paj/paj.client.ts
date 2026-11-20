import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const DEFAULT_TIMEOUT_MS = 10_000;
/** Registration confirms the account with the bank and assigns an address. */
const REGISTRATION_TIMEOUT_MS = 30_000;
const SIGNATURE_VERSION = 'v1=';

// Units of NGN per one USD. Bounds catch a reciprocal or a unit slip.
const Rate = z
  .number()
  .refine((value) => Number.isFinite(value) && value >= 10 && value <= 100000);

const RatesSchema = z.object({
  onRampRate: z.object({ rate: Rate, createdAt: z.string() }),
  offRampRate: z.object({ rate: Rate, createdAt: z.string() }),
});

const BankAccountSchema = z.object({
  id: z.string().min(1),
  accountName: z.string().min(1),
  accountNumber: z.string().min(1),
  bank: z.string(),
  address: z.string().min(32),
});

const BanksSchema = z.array(
  z.object({ code: z.string().min(1), name: z.string().min(1) }),
);

// PAJ sends amounts as JSON numbers. They are converted to integer minor
// units at the adapter, never added or multiplied as floats.
const Amount = z.number().finite().nonnegative();

const TransactionSchema = z.object({
  id: z.string().min(1),
  address: z.string().optional().nullable(),
  signature: z.string().optional().nullable(),
  amount: Amount.optional().nullable(),
  usdcAmount: Amount.optional().nullable(),
  fiatAmount: Amount.optional().nullable(),
  rate: Amount.optional().nullable(),
  status: z.string().min(1),
  createdAt: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
  accountName: z.string().optional().nullable(),
  bank: z.string().optional().nullable(),
  fee: Amount.optional().nullable(),
});

const KycStatus = z.enum(['OTP_SENT', 'VERIFIED', 'IN_REVIEW', 'DECLINED']);
const DeclineCode = z.enum([
  'ID_NOT_VERIFIED',
  'ATTEMPTS_EXCEEDED',
  'ALREADY_LINKED',
]);

const KycSessionSchema = z.object({
  sessionId: z.string().optional(),
  status: KycStatus,
  customerId: z.string().optional(),
  tier: z.number().optional(),
  declineCode: DeclineCode.optional(),
  expiresAt: z.string().optional(),
});

const KycCustomerSchema = z.object({
  customerId: z.string().min(1),
  status: KycStatus,
  tier: z.number().optional(),
  declineCode: DeclineCode.optional(),
});

const KycConsentSchema = z.object({
  version: z.string().min(1),
  text: z.string().min(1),
});

export type PajBank = z.infer<typeof BanksSchema>[number];
export type PajRates = z.infer<typeof RatesSchema>;
export type PajBankAccount = z.infer<typeof BankAccountSchema>;
export type PajTransaction = z.infer<typeof TransactionSchema>;
export type PajKycSession = z.infer<typeof KycSessionSchema>;
export type PajKycCustomer = z.infer<typeof KycCustomerSchema>;
export type PajKycConsent = z.infer<typeof KycConsentSchema>;

const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

interface RampCommon {
  /** Whole naira, or omitted when `amount` names the token side instead. */
  fiatAmount?: number;
  /** USDC, as a decimal number of whole tokens. */
  amount?: number;
  webhookURL?: string;
  customerId?: string;
}

export class PajRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PajRequestError';
  }
}

/**
 * The only code that talks to PAJ. Every request carries the business API
 * key, so this never runs in a client.
 */
@Injectable()
export class PajClient {
  constructor(private readonly config: ConfigService) {}

  async getRates(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PajRates> {
    return RatesSchema.parse(
      await this.request('/pub/v2/rate?currency=NGN', { timeoutMs }),
    );
  }

  async getBanks(): Promise<PajBank[]> {
    return BanksSchema.parse(
      await this.request('/pub/v2/bank?country=NG', {
        timeoutMs: DEFAULT_TIMEOUT_MS,
      }),
    );
  }

  /**
   * Idempotent per bank account: registering one PAJ already knows returns
   * the existing record, so a retry after a timeout is safe.
   */
  async registerBankAccount(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<PajBankAccount> {
    return BankAccountSchema.parse(
      await this.request('/pub/v2/bank-account', {
        method: 'POST',
        body: input,
        timeoutMs: REGISTRATION_TIMEOUT_MS,
      }),
    );
  }

  /**
   * Not idempotent: PAJ takes no request key, so a timeout may have opened an
   * order anyway. Callers treat any non-4xx failure as uncertain and never
   * resubmit it.
   */
  async createOnramp(
    input: RampCommon & { recipient: string; mint?: string },
  ): Promise<PajTransaction> {
    return TransactionSchema.parse(
      await this.request('/pub/v2/onramp', {
        method: 'POST',
        body: {
          currency: 'NGN',
          chain: 'SOLANA',
          mint: input.mint ?? SOLANA_USDC_MINT,
          recipient: input.recipient,
          ...rampAmounts(input),
        },
        timeoutMs: REGISTRATION_TIMEOUT_MS,
      }),
    );
  }

  /** Same uncertainty rule as createOnramp. */
  async createOfframp(
    input: RampCommon & {
      bankCode: string;
      accountNumber: string;
      mint?: string;
    },
  ): Promise<PajTransaction> {
    return TransactionSchema.parse(
      await this.request('/pub/v2/offramp', {
        method: 'POST',
        body: {
          currency: 'NGN',
          chain: 'SOLANA',
          mint: input.mint ?? SOLANA_USDC_MINT,
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          ...rampAmounts(input),
        },
        timeoutMs: REGISTRATION_TIMEOUT_MS,
      }),
    );
  }

  /** Null when PAJ has no such order, which includes one deleted after 72h. */
  async getTransaction(id: string): Promise<PajTransaction | null> {
    try {
      return TransactionSchema.parse(
        await this.request(`/pub/v2/transaction/${encodeURIComponent(id)}`, {
          timeoutMs: DEFAULT_TIMEOUT_MS,
        }),
      );
    } catch (error) {
      if (error instanceof PajRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async kycConsent(): Promise<PajKycConsent> {
    return KycConsentSchema.parse(
      await this.request('/pub/v2/kyc/consent', {
        timeoutMs: DEFAULT_TIMEOUT_MS,
      }),
    );
  }

  /** The BVN goes straight through; it is never stored or logged here. */
  async createKycSession(input: {
    externalUserId: string;
    bvn: string;
    consentVersion: string;
  }): Promise<PajKycSession> {
    return KycSessionSchema.parse(
      await this.request('/pub/v2/kyc/sessions', {
        method: 'POST',
        body: {
          externalUserId: input.externalUserId,
          idNumber: input.bvn,
          idType: 'BVN',
          country: 'NG',
          consentVersion: input.consentVersion,
        },
        timeoutMs: REGISTRATION_TIMEOUT_MS,
      }),
    );
  }

  async verifyKycOtp(sessionId: string, otp: string): Promise<PajKycSession> {
    return KycSessionSchema.parse(
      await this.request(
        `/pub/v2/kyc/sessions/${encodeURIComponent(sessionId)}/verify-otp`,
        { method: 'POST', body: { otp }, timeoutMs: DEFAULT_TIMEOUT_MS },
      ),
    );
  }

  async resendKycOtp(sessionId: string): Promise<PajKycSession> {
    return KycSessionSchema.parse(
      await this.request(
        `/pub/v2/kyc/sessions/${encodeURIComponent(sessionId)}/resend-otp`,
        { method: 'POST', body: {}, timeoutMs: DEFAULT_TIMEOUT_MS },
      ),
    );
  }

  async getKycCustomer(customerId: string): Promise<PajKycCustomer> {
    return KycCustomerSchema.parse(
      await this.request(
        `/pub/v2/customers/${encodeURIComponent(customerId)}`,
        { timeoutMs: DEFAULT_TIMEOUT_MS },
      ),
    );
  }

  /**
   * PAJ signs `{timestamp}.{raw body}` with HMAC-SHA256 and sends the hex
   * digest as `v1=<digest>`. The timestamp is inside the signed string, so a
   * captured delivery cannot be re-dated.
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    timestamp: string | undefined,
    signature: string | undefined,
  ): void {
    const secret = this.config.get<string>('PAJ_WEBHOOK_SECRET') ?? '';
    // An empty key would let anyone sign a body that verifies.
    if (!secret) {
      throw new HttpException(
        'webhook verification is not configured',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!timestamp || !signature?.startsWith(SIGNATURE_VERSION)) {
      throw new HttpException(
        'invalid webhook signature',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex');
    const a = Buffer.from(expected, 'utf-8');
    const b = Buffer.from(signature.slice(SIGNATURE_VERSION.length), 'utf-8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new HttpException(
        'invalid webhook signature',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private async request(
    path: string,
    init: { method?: string; body?: unknown; timeoutMs: number },
  ): Promise<unknown> {
    const apiKey = this.config.get<string>('PAJ_API_KEY');
    if (!apiKey) throw new PajRequestError(0, 'PAJ_API_KEY is not configured');
    const base = this.config.getOrThrow<string>('PAJ_API_BASE');
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      redirect: 'error',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs),
    });
    if (!response.ok) {
      throw new PajRequestError(
        response.status,
        `paj ${path} failed status=${response.status} ${await describe(response)}`,
      );
    }
    return response.json();
  }
}

function rampAmounts(input: RampCommon): Record<string, unknown> {
  if ((input.fiatAmount === undefined) === (input.amount === undefined)) {
    throw new PajRequestError(0, 'send exactly one of fiatAmount or amount');
  }
  return {
    ...(input.fiatAmount !== undefined ? { fiatAmount: input.fiatAmount } : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.webhookURL ? { webhookURL: input.webhookURL } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
  };
}

/** Validation failures arrive as an array of messages, the rest as a string. */
async function describe(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: string | string[];
  } | null;
  const message = body?.message;
  return Array.isArray(message) ? message.join(', ') : (message ?? '');
}
