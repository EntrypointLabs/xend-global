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

/**
 * Parse the launch parameters from the popup URL. Reads only nonce, mode, and
 * intent. Amount, currency, merchant, and origin are never read from the URL:
 * every money-related and trust-related value comes from the server record.
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

  return { reference: intent, nonce, mode };
}
