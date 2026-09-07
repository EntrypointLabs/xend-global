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
 * (GET /checkout/intents/:reference). Carries the Merchant's own currency and
 * the figure they quoted, and deliberately no rate: a converted price is shown
 * from the quote pinned at creation, never recomputed here.
 */
export interface IntentView {
  reference: string;
  status: IntentStatus;
  merchantDisplayName: string;
  /** ISO 4217, whatever the Merchant priced in. */
  displayCurrency: string;
  displayAmountMinor: string;
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

export interface TerminalResult {
  status: 'succeeded' | 'failed';
  redirectUrl?: string;
  cancelUrl?: string;
}

/**
 * What authorize hands back.
 *
 * 'needs_signature' carries the Spend out of the Consumer's Account. The
 * passkey proves who they are and the Account's own signer moves the money,
 * which are two different things, so a Payment takes two calls: authorize to
 * be recognised and get the Spend, settle to hand back the signed bytes.
 */
export type AuthorizeResult =
  | {
      status: 'needs_signature';
      unsignedTxBase64: string;
      /** Which of the Consumer's keys the Spend was compiled for. */
      signerAddress: string;
    }
  | TerminalResult;

export interface SettleInput {
  reference: string;
  signedTxBase64: string;
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
  /** Above the band one signature carries; only the Xend app can finish it. */
  | 'APPROVAL_REQUIRED'
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
    case 'APPROVAL_REQUIRED':
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
    displayCurrency: 'NGN',
    displayAmountMinor: '4500000',
    merchantOrigin: window.location.origin,
    // Both fixture states stay reachable: `?recognized=1` demos the one-tap
    // return visit, without it the full passkey ceremony shows.
    sessionRecognized: new URLSearchParams(window.location.search).has(
      'recognized',
    ),
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

export async function getIntent(
  reference: string,
  opener: string | null = null,
): Promise<IntentView> {
  if (useFixture) return fixtureIntent(reference);
  const query = opener ? `?opener=${encodeURIComponent(opener)}` : '';
  return request<IntentView>(
    `/checkout/intents/${encodeURIComponent(reference)}${query}`,
  );
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

/** Hands the signed Spend back. This is where the money actually moves. */
export async function settle(input: SettleInput): Promise<TerminalResult> {
  if (useFixture) return { status: 'succeeded' };
  return request<TerminalResult>('/checkout/settle', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
