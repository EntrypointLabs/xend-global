/**
 * Per-merchant frame-ancestors for the checkout surface.
 *
 * public/_headers is the default: `frame-ancestors 'none'` plus
 * `X-Frame-Options: DENY`, which is what any response this function leaves
 * alone keeps serving. A document load that names an intent is the one case
 * that can be relaxed, and only as far as the single origin the API reports for
 * that intent. That origin has already been checked against the Merchant's
 * registered allowedOrigins server-side, which is why it is nameable at all;
 * the query string's own `opener` parameter is unchecked and is never read here.
 */

interface PagesContext {
  request: Request;
  env: Record<string, string | undefined>;
  next: () => Promise<Response>;
}

interface IntentSummary {
  merchantOrigin?: unknown;
}

const REFERENCE_PATTERN = /^pi_[A-Za-z0-9_-]{1,128}$/;

const SUMMARY_TTL_MS = 60_000;
const SUMMARY_TIMEOUT_MS = 2_000;
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  origin: string | null;
  expiresAt: number;
}

const originCache = new Map<string, CacheEntry>();

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}

/**
 * An origin is only usable here if it round-trips through URL unchanged, so
 * nothing carrying a space, a semicolon or a path can reach the header.
 */
function parseOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const httpLoopback = url.protocol === 'http:' && isLoopbackHost(url.hostname);
  if (url.protocol !== 'https:' && !httpLoopback) return null;
  return url.origin === raw ? raw : null;
}

function readReference(requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  const intent = url.searchParams.get('intent');
  if (!intent || !REFERENCE_PATTERN.test(intent)) return null;
  return intent;
}

async function fetchMerchantOrigin(
  apiBase: string,
  reference: string,
): Promise<string | null> {
  const res = await fetch(
    `${apiBase}/checkout/intents/${encodeURIComponent(reference)}`,
    {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
    },
  );
  if (!res.ok) return null;
  const summary = (await res.json()) as IntentSummary;
  return parseOrigin(summary.merchantOrigin);
}

async function merchantOriginFor(
  apiBase: string,
  reference: string,
): Promise<string | null> {
  const now = Date.now();
  const hit = originCache.get(reference);
  if (hit && hit.expiresAt > now) return hit.origin;

  let origin: string | null = null;
  try {
    origin = await fetchMerchantOrigin(apiBase, reference);
  } catch {
    // An API that is slow, down or unreachable leaves the static deny standing.
    return null;
  }

  if (originCache.size >= CACHE_MAX_ENTRIES) originCache.clear();
  originCache.set(reference, { origin, expiresAt: now + SUMMARY_TTL_MS });
  return origin;
}

/**
 * Only a document load can be framed, so only a document load is worth an API
 * call. A subresource carrying the same query string gets the static deny.
 */
function isDocumentRequest(request: Request): boolean {
  const dest = request.headers.get('sec-fetch-dest');
  if (dest) return dest === 'document' || dest === 'iframe';
  return (request.headers.get('accept') ?? '').includes('text/html');
}

/**
 * Replace the frame-ancestors directive and leave every other one alone, so a
 * later policy gaining script-src or connect-src does not lose it here.
 */
function withFrameAncestors(existing: string | null, origin: string): string {
  const kept = (existing ?? '')
    .split(';')
    .map((directive) => directive.trim())
    .filter(
      (directive) =>
        directive.length > 0 && !/^frame-ancestors\b/i.test(directive),
    );
  return [...kept, `frame-ancestors ${origin}`].join('; ');
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const response = await context.next();

  if (!isDocumentRequest(context.request)) return response;

  const reference = readReference(context.request.url);
  if (!reference) return response;

  const apiBase =
    context.env.CHECKOUT_API_BASE ?? new URL(context.request.url).origin;
  const merchantOrigin = await merchantOriginFor(apiBase, reference);
  if (!merchantOrigin) return response;

  const headers = new Headers(response.headers);
  headers.set(
    'Content-Security-Policy',
    withFrameAncestors(headers.get('Content-Security-Policy'), merchantOrigin),
  );
  // X-Frame-Options cannot express an allowlist, so it has to go where CSP
  // names an origin. Modern browsers take frame-ancestors over it regardless.
  headers.delete('X-Frame-Options');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
