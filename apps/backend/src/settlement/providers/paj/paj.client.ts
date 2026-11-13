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

export type PajBank = z.infer<typeof BanksSchema>[number];
export type PajRates = z.infer<typeof RatesSchema>;
export type PajBankAccount = z.infer<typeof BankAccountSchema>;

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

/** Validation failures arrive as an array of messages, the rest as a string. */
async function describe(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: string | string[];
  } | null;
  const message = body?.message;
  return Array.isArray(message) ? message.join(', ') : (message ?? '');
}
