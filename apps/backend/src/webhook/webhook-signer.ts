import { createHmac, timingSafeEqual } from 'node:crypto';

/** Stripe-style header value: t=<unix>,v1=<hex>[,v1=<hex>].
 *  One v1 per active secret so dual-secret rotation is a non-event. */
export function signWebhook(
  rawBody: string,
  secrets: string[],
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const v1s = secrets
    .filter(Boolean)
    .map((s) =>
      createHmac('sha256', s).update(`${timestamp}.${rawBody}`).digest('hex'),
    );
  return [`t=${timestamp}`, ...v1s.map((v) => `v1=${v}`)].join(',');
}

/** Contract-documenting verifier. The SDK ships the merchant-facing
 *  one; this proves the scheme and backs the E2E tests. */
export function verifyWebhook(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSeconds: number,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=') as [string, string]),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  const given = header
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3));
  const eb = Buffer.from(expected, 'hex');
  return given.some((g) => {
    const gb = Buffer.from(g, 'hex');
    return gb.length === eb.length && timingSafeEqual(gb, eb);
  });
}
