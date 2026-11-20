import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const DEFAULT_TIMEOUT_MS = 15_000;
const LOOKUP_PAGE_SIZE = 100;
const LOOKUP_MAX_PAGES = 5;

const Decimal = z.string().regex(/^\d+(\.\d+)?$/);

const Envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

const RateSchema = Envelope(
  z.object({
    sell: z.object({
      rate: Decimal,
      providerIds: z.array(z.string()).default([]),
    }),
  }),
);

const OrderSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  reference: z.string().optional().nullable(),
  amount: Decimal.optional(),
  rate: Decimal.optional(),
  txHash: z.string().optional().nullable(),
  paymentReference: z.string().optional().nullable(),
});

const CreatedOrderSchema = Envelope(
  OrderSchema.extend({
    providerAccount: z.object({
      network: z.string(),
      receiveAddress: z.string().min(32),
      amountToTransfer: Decimal,
      validUntil: z.string(),
    }),
  }),
);

const InstitutionsSchema = Envelope(
  z.array(z.object({ code: z.string(), name: z.string(), type: z.string() })),
);

export type PaycrestOrder = z.infer<typeof OrderSchema>;
export type PaycrestCreatedOrder = z.infer<typeof CreatedOrderSchema>['data'];
export type PaycrestInstitution = { code: string; name: string };

export class PaycrestRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PaycrestRequestError';
  }
}

/**
 * The only code that talks to Paycrest. Paycrest has no sandbox, so every
 * order here is a real payout; the key never leaves the server.
 */
@Injectable()
export class PaycrestClient {
  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return Boolean(this.config.get<string>('PAYCREST_API_KEY'));
  }

  async sellRate(
    usdc: string,
  ): Promise<{ rate: string; providerIds: string[] } | null> {
    const response = await this.request(
      `/v2/rates/solana/USDC/${encodeURIComponent(usdc)}/NGN?side=sell&limit=3`,
      { acceptStatuses: [404] },
    );
    if (response === null) return null;
    const sell = RateSchema.parse(response).data.sell;
    return sell.providerIds.length > 0
      ? { rate: sell.rate, providerIds: sell.providerIds }
      : null;
  }

  async institutions(): Promise<PaycrestInstitution[]> {
    const response = InstitutionsSchema.parse(
      await this.request('/v2/institutions/NGN'),
    );
    return response.data
      .filter((entry) => entry.type === 'bank' || entry.type === 'mobile_money')
      .map(({ code, name }) => ({ code, name }));
  }

  /** The account holder's name; null when the bank confirms it without one. */
  async verifyAccount(
    institution: string,
    accountNumber: string,
  ): Promise<{ found: false } | { found: true; accountName: string | null }> {
    const response = await this.request('/v2/verify-account', {
      method: 'POST',
      body: { institution, accountIdentifier: accountNumber },
      acceptStatuses: [400],
    });
    if (response === null) return { found: false };
    const name = (response as { data?: unknown }).data;
    if (typeof name !== 'string' || !name) {
      throw new PaycrestRequestError(502, 'verify-account returned no data');
    }
    return { found: true, accountName: name === 'OK' ? null : name.trim() };
  }

  /** Not idempotent at Paycrest: a lost response is found by `reference`. */
  async createOrder(input: {
    usdc: string;
    rate: string;
    providerIds: string[];
    reference: string;
    refundAddress: string;
    institution: string;
    accountNumber: string;
    accountName: string;
  }): Promise<PaycrestCreatedOrder> {
    return CreatedOrderSchema.parse(
      await this.request('/v2/sender/orders', {
        method: 'POST',
        body: {
          amount: input.usdc,
          rate: input.rate,
          reference: input.reference,
          transactionFeePayer: 'customer',
          source: {
            type: 'crypto',
            currency: 'USDC',
            network: 'solana',
            refundAddress: input.refundAddress,
          },
          destination: {
            type: 'fiat',
            currency: 'NGN',
            country: 'NG',
            ...(input.providerIds.length > 0
              ? { providerIds: input.providerIds }
              : {}),
            recipient: {
              institution: input.institution,
              accountIdentifier: input.accountNumber,
              accountName: input.accountName,
              memo: input.reference,
            },
          },
        },
      }),
    ).data;
  }

  async getOrder(id: string): Promise<PaycrestOrder | null> {
    const response = await this.request(
      `/v2/sender/orders/${encodeURIComponent(id)}`,
      { acceptStatuses: [404] },
    );
    return response === null
      ? null
      : Envelope(OrderSchema).parse(response).data;
  }

  /** Searches by our own reference, for an order whose creation timed out. */
  async findByReference(reference: string): Promise<PaycrestOrder | null> {
    for (let page = 1; page <= LOOKUP_MAX_PAGES; page++) {
      const response = Envelope(
        z.object({
          orders: z.array(OrderSchema),
          total: z.number().optional(),
        }),
      ).parse(
        await this.request(
          `/v2/sender/orders?search=${encodeURIComponent(reference)}&page=${page}&pageSize=${LOOKUP_PAGE_SIZE}`,
        ),
      );
      const match = response.data.orders.find(
        (order) => order.reference === reference,
      );
      if (match) return match;
      const total = response.data.total ?? Number.POSITIVE_INFINITY;
      if (
        page * LOOKUP_PAGE_SIZE >= total ||
        response.data.orders.length < LOOKUP_PAGE_SIZE
      ) {
        return null;
      }
    }
    // Saying "absent" after a partial search would let a paid order be redone.
    throw new PaycrestRequestError(503, 'reference lookup was not exhaustive');
  }

  /** Paycrest signs the raw body with HMAC-SHA256, hex, keyed by the API secret. */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined) {
    const secret = this.config.get<string>('PAYCREST_API_SECRET') ?? '';
    if (!secret || !signature) return false;
    const expected = Buffer.from(
      createHmac('sha256', secret).update(rawBody).digest('hex'),
      'utf-8',
    );
    const given = Buffer.from(signature.trim().toLowerCase(), 'utf-8');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private async request(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      acceptStatuses?: number[];
    } = {},
  ): Promise<unknown> {
    const apiKey = this.config.get<string>('PAYCREST_API_KEY');
    if (!apiKey) {
      throw new PaycrestRequestError(0, 'PAYCREST_API_KEY is not configured');
    }
    const base =
      this.config.get<string>('PAYCREST_API_BASE') ?? 'https://api.paycrest.io';
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      redirect: 'error',
      headers: { 'API-Key': apiKey, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (init.acceptStatuses?.includes(response.status)) return null;
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: unknown;
      } | null;
      const message =
        typeof body?.message === 'string' ? body.message : 'request failed';
      throw new PaycrestRequestError(
        response.status,
        `paycrest ${path.split('?')[0]} status=${response.status} ${message}`,
      );
    }
    return response.json();
  }
}
