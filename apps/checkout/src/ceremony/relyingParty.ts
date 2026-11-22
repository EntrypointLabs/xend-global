import { RP_ORIGIN } from '../lib/config';

const PASSKEY_AUTHENTICATE_INIT = '/api/v1/passkeys/authenticate/init';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Privy's web SDK starts a passkey sign-in without naming a relying party, so
 * Privy answers with the page's own host (pay.prydd.co) and the browser looks
 * for a passkey nobody has: every passkey is made by the app for prydd.co. The
 * mobile SDK names the relying party on the same endpoint, and a page on a
 * subdomain may ask for its registrable parent, so naming prydd.co here lets
 * the checkout use the passkey the Consumer already has.
 *
 * Only that one request is touched; everything else passes through unchanged.
 */
export function pinPasskeyRelyingParty(target: typeof globalThis): () => void {
  const original = target.fetch;
  const pinned: typeof fetch = (input, init) => {
    if (
      urlOf(input).endsWith(PASSKEY_AUTHENTICATE_INIT) &&
      typeof init?.body === 'string'
    ) {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        return original(input, {
          ...init,
          body: JSON.stringify({ ...body, relying_party: RP_ORIGIN }),
        });
      } catch {
        // A body that is not JSON is not the request this exists for.
      }
    }
    return original(input, init);
  };
  target.fetch = pinned;
  return () => {
    if (target.fetch === pinned) target.fetch = original;
  };
}
