import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequest } from './_middleware';

const API_BASE = 'https://api.test';
const MERCHANT = 'https://shop.example.com';

const DENY_HEADERS = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
};

let seq = 0;
/** Unique per test so one case never reads another's cached summary. */
function reference() {
  seq += 1;
  return `pi_case${seq}`;
}

function context(url: string) {
  return {
    request: new Request(url, {
      headers: { 'sec-fetch-dest': 'iframe' },
    }),
    env: { CHECKOUT_API_BASE: API_BASE },
    next: () =>
      Promise.resolve(
        new Response('<!doctype html>', { status: 200, headers: DENY_HEADERS }),
      ),
  };
}

function stubSummary(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('onRequest', () => {
  it('names the merchant origin in frame-ancestors and drops X-Frame-Options', async () => {
    stubSummary({ merchantOrigin: MERCHANT });
    const ref = reference();
    const res = await onRequest(
      context(`https://pay.xend.global/?nonce=n1&mode=iframe&intent=${ref}`),
    );

    expect(res.headers.get('content-security-policy')).toBe(
      `frame-ancestors ${MERCHANT}`,
    );
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<!doctype html>');
  });

  it('asks the API for exactly the public summary of that intent', async () => {
    const fetchMock = stubSummary({ merchantOrigin: MERCHANT });
    const ref = reference();
    await onRequest(context(`https://pay.xend.global/?intent=${ref}`));

    expect(fetchMock.mock.calls[0]![0]).toBe(
      `${API_BASE}/checkout/intents/${ref}`,
    );
  });

  it('keeps the static deny when the URL carries no intent', async () => {
    const fetchMock = stubSummary({ merchantOrigin: MERCHANT });
    const res = await onRequest(
      context('https://pay.xend.global/?nonce=n1&mode=iframe'),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('keeps the static deny for a malformed reference without calling the API', async () => {
    const fetchMock = stubSummary({ merchantOrigin: MERCHANT });
    const res = await onRequest(
      context('https://pay.xend.global/?intent=../../etc/passwd'),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('keeps the static deny when the summary is missing or has no origin', async () => {
    stubSummary({}, false);
    const notFound = await onRequest(
      context(`https://pay.xend.global/?intent=${reference()}`),
    );
    expect(notFound.headers.get('x-frame-options')).toBe('DENY');

    stubSummary({ merchantOrigin: null });
    const noOrigin = await onRequest(
      context(`https://pay.xend.global/?intent=${reference()}`),
    );
    expect(noOrigin.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'none'",
    );
  });

  it('keeps the static deny when the API call fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const res = await onRequest(
      context(`https://pay.xend.global/?intent=${reference()}`),
    );
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it.each([
    ['a path', 'https://shop.example.com/checkout'],
    ['plain http', 'http://shop.example.com'],
    ['a header injection attempt', 'https://shop.example.com; frame-src *'],
    ['the opaque origin', 'null'],
    ['a non-string', 42],
  ])('refuses to name %s as an ancestor', async (_label, value) => {
    stubSummary({ merchantOrigin: value });
    const res = await onRequest(
      context(`https://pay.xend.global/?intent=${reference()}`),
    );
    expect(res.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('never reads the merchant origin from the query string', async () => {
    stubSummary({ merchantOrigin: null });
    const res = await onRequest(
      context(
        `https://pay.xend.global/?intent=${reference()}&opener=${encodeURIComponent(
          'https://evil.example.com',
        )}`,
      ),
    );
    expect(res.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'none'",
    );
  });

  it('leaves a subresource load on the static deny without asking the API', async () => {
    const fetchMock = stubSummary({ merchantOrigin: MERCHANT });
    const ref = reference();
    const ctx = context(`https://pay.xend.global/assets/app.js?intent=${ref}`);
    ctx.request = new Request(ctx.request.url, {
      headers: { 'sec-fetch-dest': 'script' },
    });

    const res = await onRequest(ctx);

    expect(res.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'none'",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps directives the policy already carried', async () => {
    stubSummary({ merchantOrigin: MERCHANT });
    const ref = reference();
    const ctx = context(`https://pay.xend.global/?intent=${ref}`);
    ctx.next = () =>
      Promise.resolve(
        new Response('<!doctype html>', {
          status: 200,
          headers: {
            'content-security-policy':
              "default-src 'self'; frame-ancestors 'none'",
          },
        }),
      );

    const res = await onRequest(ctx);
    const policy = res.headers.get('content-security-policy') ?? '';

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain(`frame-ancestors ${MERCHANT}`);
    expect(policy).not.toContain("frame-ancestors 'none'");
  });

  it('serves a repeat load of the same intent from the cached summary', async () => {
    const fetchMock = stubSummary({ merchantOrigin: MERCHANT });
    const url = `https://pay.xend.global/?intent=${reference()}`;

    const first = await onRequest(context(url));
    const second = await onRequest(context(url));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.headers.get('content-security-policy')).toBe(
      first.headers.get('content-security-policy'),
    );
  });

  it('falls back to the surface origin when no API base is configured', async () => {
    const fetchMock = stubSummary({ merchantOrigin: MERCHANT });
    const ref = reference();
    await onRequest({
      ...context(`https://pay.xend.global/?intent=${ref}`),
      env: {},
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://pay.xend.global/checkout/intents/${ref}`,
    );
  });
});
