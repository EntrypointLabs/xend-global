import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The signed return-URL scheme for redirect-completion mode. Consumers of this
 * contract (the checkout redirect flow and the SDK docs):
 *
 *   key    = CHECKOUT_RETURN_URL_SECRET (an internal Xend secret; merchants
 *            never verify these params, their fulfillment truth stays the
 *            webhook and GET /v1/payment_intents/:id, and the params
 *            deliberately carry no amount).
 *   TTL    = CHECKOUT_RETURN_URL_TTL_SECONDS (default 900) plus 60s forward
 *            clock skew.
 *   params = xend_intent_id, xend_status, xend_ts, xend_sig
 *            (sig = hex HMAC-SHA256 over `intentId.status.ts.baseUrl`).
 *
 * Signing the base URL too means a swapped target fails verification.
 */
export type ReturnStatus = 'succeeded' | 'failed' | 'canceled' | 'expired';

function canonical(
  baseUrl: string,
  intentId: string,
  status: ReturnStatus,
  ts: number,
): string {
  return `${intentId}.${status}.${ts}.${baseUrl}`;
}

export function signReturnUrl(
  baseUrl: string,
  intentId: string,
  status: ReturnStatus,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): string {
  const sig = createHmac('sha256', secret)
    .update(canonical(baseUrl, intentId, status, now))
    .digest('hex');
  const url = new URL(baseUrl);
  url.searchParams.set('xend_intent_id', intentId);
  url.searchParams.set('xend_status', status);
  url.searchParams.set('xend_ts', String(now));
  url.searchParams.set('xend_sig', sig);
  return url.toString();
}

export function verifyReturnUrl(
  baseUrl: string,
  intentId: string,
  status: ReturnStatus,
  ts: number,
  sig: string,
  secret: string,
  ttlSeconds: number,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isFinite(ts) || now - ts > ttlSeconds || ts > now + 60) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(canonical(baseUrl, intentId, status, ts))
    .digest('hex');
  const eb = Buffer.from(expected, 'hex');
  const gb = Buffer.from(sig, 'hex');
  return gb.length === eb.length && timingSafeEqual(gb, eb);
}
