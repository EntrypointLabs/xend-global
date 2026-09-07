export type LaunchMode = 'popup' | 'redirect';

export interface Launch {
  /**
   * The intent id (the wire `reference`). Null on the handshake first load:
   * the SDK opens the popup synchronously before the intent exists, then
   * navigates to append `intent=<reference>` once it does. Null is normal,
   * never an error.
   */
  reference: string | null;
  nonce: string;
  mode: LaunchMode;
  /**
   * The origin of the merchant page that opened the checkout, so the result
   * goes back to that page rather than to whichever allowed origin the
   * Merchant registered first. Read here only to be handed to the backend,
   * which decides whether it is one of the Merchant's origins; a malformed or
   * opaque value is dropped, never fatal.
   */
  opener: string | null;
}

export class LaunchError extends Error {
  readonly code: 'MISSING_NONCE' | 'MALFORMED_REFERENCE';
  constructor(code: 'MISSING_NONCE' | 'MALFORMED_REFERENCE', message: string) {
    super(message);
    this.name = 'LaunchError';
    this.code = code;
  }
}

const REFERENCE_PATTERN = /^pi_[A-Za-z0-9_-]+$/;

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}

function parseOpener(raw: string | null): string | null {
  if (!raw) return null;
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

/**
 * Parse the launch parameters from the popup URL. Reads only nonce, mode,
 * intent and the opener origin. Amount, currency and merchant are never read
 * from the URL: every money-related and trust-related value comes from the
 * server record, and the opener is only ever a hint the backend checks.
 */
export function parseLaunch(search: string): Launch {
  const params = new URLSearchParams(search);

  const nonce = params.get('nonce');
  if (!nonce) {
    throw new LaunchError('MISSING_NONCE', 'Launch is missing a nonce.');
  }

  const modeParam = params.get('mode');
  const mode: LaunchMode = modeParam === 'redirect' ? 'redirect' : 'popup';

  const intent = params.get('intent');
  if (intent !== null && !REFERENCE_PATTERN.test(intent)) {
    throw new LaunchError(
      'MALFORMED_REFERENCE',
      'Launch carries a malformed intent reference.',
    );
  }

  return {
    reference: intent,
    nonce,
    mode,
    opener: parseOpener(params.get('opener')),
  };
}
