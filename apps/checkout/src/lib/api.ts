import { API_BASE } from './config';

/**
 * Payable and terminal intent statuses. The non-payable terminals
 * (succeeded, canceled, expired) let the surface render a terminal state
 * instead of a payable sheet. Phase 6 owns the canonical set; the surface
 * only needs to distinguish payable from non-payable.
 */
export type IntentStatus =
  | 'requires_payment'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'expired';

/**
 * The checkout intent summary. camelCase per the Phase 6 wire contract
 * (GET /checkout/intents/:reference). Carries no fx rate and no usd figure:
 * naira is displayed from the pinned quote only.
 */
export interface IntentView {
  reference: string;
  status: IntentStatus;
  merchantDisplayName: string;
  ngnDisplayMinor: string;
  merchantOrigin: string;
  sessionRecognized: boolean;
  expiresAt: string;
  livemode: boolean;
  /**
   * Backend-signed cancel return URL for redirect mode, used when a Consumer
   * backs out before authorize (no authorize response exists yet). Phase 6 signs
   * it at intent creation; absent for popup-only intents.
   */
  cancelUrl?: string | null;
}

export interface AuthorizeInput {
  reference: string;
  /**
   * Provider-neutral wire name. In v1 the value is the Privy identity token,
   * present only on the ceremony path. The session path relies on the cookie.
   */
  providerToken?: string;
}

export interface AuthorizeResult {
  status: 'succeeded' | 'failed';
  redirectUrl?: string;
  cancelUrl?: string;
}

export const NON_PAYABLE_STATUSES: ReadonlySet<IntentStatus> = new Set([
  'succeeded',
  'canceled',
  'expired',
]);

export function isNonPayable(status: IntentStatus): boolean {
  return NON_PAYABLE_STATUSES.has(status);
}

export type CheckoutErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'INTENT_EXPIRED'
  | 'PAYMENT_PROCESSING'
  | 'UNSUPPORTED_CURRENCY'
  | 'UNKNOWN';

export class CheckoutApiError extends Error {
  readonly code: CheckoutErrorCode;
  readonly status: number;
  constructor(code: CheckoutErrorCode, message: string, status: number) {
    super(message);
    this.name = 'CheckoutApiError';
    this.code = code;
    this.status = status;
  }
}

function toErrorCode(raw: unknown): CheckoutErrorCode {
  switch (raw) {
    case 'INSUFFICIENT_BALANCE':
    case 'INTENT_EXPIRED':
    case 'PAYMENT_PROCESSING':
      return raw;
    default:
      return 'UNKNOWN';
  }
}

const useFixture = import.meta.env.DEV && API_BASE === '';

function fixtureIntent(reference: string): IntentView {
  return {
    reference,
    status: 'requires_payment',
    merchantDisplayName: 'Sabi Market',
    ngnDisplayMinor: '4500000',
    merchantOrigin: window.location.origin,
    sessionRecognized: false,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    livemode: false,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    let code: CheckoutErrorCode = 'UNKNOWN';
    let message = `Request failed with ${res.status}`;
    try {
      const body = (await res.json()) as { code?: unknown; message?: unknown };
      code = toErrorCode(body.code);
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Non-JSON error body; keep the status-derived defaults.
    }
    throw new CheckoutApiError(code, message, res.status);
  }

  return (await res.json()) as T;
}

export async function getIntent(reference: string): Promise<IntentView> {
  if (useFixture) return fixtureIntent(reference);
  const intent = await request<
    Omit<IntentView, 'ngnDisplayMinor'> & { ngnDisplayMinor: string | null }
  >(`/checkout/intents/${encodeURIComponent(reference)}`);
  // This surface renders the naira amount only; USDC intents leave
  // ngnDisplayMinor null, so fail loud here instead of crashing later on
  // BigInt(null) inside formatNairaFromMinor.
  const { ngnDisplayMinor } = intent;
  if (ngnDisplayMinor === null) {
    throw new CheckoutApiError(
      'UNSUPPORTED_CURRENCY',
      'this checkout supports NGN intents only',
      400,
    );
  }
  return { ...intent, ngnDisplayMinor };
}

export async function authorize(
  input: AuthorizeInput,
): Promise<AuthorizeResult> {
  if (useFixture) return { status: 'succeeded' };
  return request<AuthorizeResult>('/checkout/authorize', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
