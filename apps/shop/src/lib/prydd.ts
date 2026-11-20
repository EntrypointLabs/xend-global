import "server-only";

export type IntentStatus =
  | "created"
  | "authorized"
  | "settling"
  | "succeeded"
  | "failed"
  | "expired"
  | "canceled";

export interface PaymentIntent {
  id: string;
  status: IntentStatus;
  currency: string;
  amount: string;
  usdc_settlement_raw: string;
  merchant_reference: string | null;
  livemode: boolean;
  expires_at: string;
  metadata: Record<string, string> | null;
}

export class PryddApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const pryddConfig = {
  apiBase: process.env.PRYDD_API_BASE ?? "https://api.prydd.co",
  checkoutOrigin:
    process.env.NEXT_PUBLIC_PRYDD_CHECKOUT_ORIGIN ?? "https://pay.prydd.co",
};

function secretKey(): string {
  const key = process.env.PRYDD_SECRET_KEY;
  if (!key)
    throw new PryddApiError(
      500,
      "NOT_CONFIGURED",
      "PRYDD_SECRET_KEY is not set",
    );
  return key;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${pryddConfig.apiBase}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${secretKey()}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new PryddApiError(
      res.status,
      body?.code ?? `HTTP_${res.status}`,
      body?.message ?? `Prydd API answered ${res.status}`,
    );
  }
  return body as T;
}

export function createIntent(input: {
  amountCents: number;
  orderId: string;
  orderNumber: string;
  returnUrl?: string;
  cancelUrl?: string;
}): Promise<PaymentIntent> {
  return call<PaymentIntent>("/v1/payment_intents", {
    method: "POST",
    headers: { "idempotency-key": `shop-${input.orderId}` },
    body: JSON.stringify({
      amount: String(input.amountCents),
      currency: "USD",
      merchant_reference: input.orderNumber,
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
      metadata: { order_id: input.orderId },
    }),
  });
}

export function getIntent(id: string): Promise<PaymentIntent> {
  return call<PaymentIntent>(`/v1/payment_intents/${encodeURIComponent(id)}`);
}
