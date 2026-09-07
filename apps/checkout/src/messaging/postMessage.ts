// Builders come from the zod-free subpath so the popup entry never bundles zod
// (the sender never validates; only the SDK listener parses).
import {
  buildReady,
  buildResult,
  buildCancel,
} from '@xend/checkout-protocol/build';
import type { CheckoutStatus } from '@xend/checkout-protocol';
import { isFramed } from '../lib/frame';

/**
 * The window the merchant page is listening on: its own frame when the surface
 * is embedded, the opener when it was launched as a popup. Null when neither
 * channel exists, which is COOP having severed the opener.
 */
function merchantWindow(): WindowProxy | null {
  if (isFramed()) return window.parent as WindowProxy;
  return (window.opener as WindowProxy | null) ?? null;
}

/**
 * Tell the merchant page the surface is here. Sent on mount, including on the
 * intent-less first load, which is exactly when an embedding SDK is waiting to
 * hear something: a frame the checkout refused to be embedded in can never
 * send this, so its arrival is what proves the inline ceremony is live.
 *
 * This is the one message sent before an intent exists, so its target is the
 * origin the launch URL named rather than the server-verified one on the
 * intent. That is acceptable here and nowhere else: it carries only the nonce
 * the receiver itself generated, while every terminal message still goes to
 * the merchant origin the server stored.
 */
export function postReadyToMerchant(
  merchantOrigin: string,
  nonce: string,
): boolean {
  const target = merchantWindow();
  if (!target) return false;
  target.postMessage(buildReady(nonce), merchantOrigin);
  return true;
}

/**
 * Post a terminal result to the merchant page. The target origin is the exact
 * server-stored merchant origin, never document.referrer and never a wildcard.
 * Returns false when there is no channel, so the caller can fall back to a
 * return-to-store state or the redirect path.
 */
export function postResultToMerchant(
  merchantOrigin: string,
  nonce: string,
  reference: string,
  status: CheckoutStatus,
): boolean {
  const target = merchantWindow();
  if (!target) return false;
  target.postMessage(buildResult(nonce, reference, status), merchantOrigin);
  return true;
}

/**
 * Post a user-initiated cancel to the merchant page. Carries status 'canceled'
 * by contract. Same exact-origin and missing-channel discipline as the result
 * sender.
 */
export function postCancelToMerchant(
  merchantOrigin: string,
  nonce: string,
  reference: string,
): boolean {
  const target = merchantWindow();
  if (!target) return false;
  target.postMessage(buildCancel(nonce, reference), merchantOrigin);
  return true;
}
