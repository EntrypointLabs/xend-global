// Builders come from the zod-free subpath so the popup entry never bundles zod
// (the sender never validates; only the SDK listener parses).
import { buildResult, buildCancel } from '@xend/checkout-protocol/build';
import type { CheckoutStatus } from '@xend/checkout-protocol';

/**
 * Post a terminal result to the merchant page over the opener channel. The
 * target origin is the exact server-stored merchant origin, never
 * document.referrer and never a wildcard. Returns false when window.opener is
 * gone (COOP severed the channel), so the caller can fall back to a
 * return-to-store state or the redirect path.
 */
export function postResultToOpener(
  merchantOrigin: string,
  nonce: string,
  reference: string,
  status: CheckoutStatus,
): boolean {
  const opener = window.opener as WindowProxy | null;
  if (!opener) return false;
  opener.postMessage(buildResult(nonce, reference, status), merchantOrigin);
  return true;
}

/**
 * Post a user-initiated cancel to the merchant page. Carries status 'canceled'
 * by contract. Same exact-origin and null-opener discipline as the result
 * sender.
 */
export function postCancelToOpener(
  merchantOrigin: string,
  nonce: string,
  reference: string,
): boolean {
  const opener = window.opener as WindowProxy | null;
  if (!opener) return false;
  opener.postMessage(buildCancel(nonce, reference), merchantOrigin);
  return true;
}
