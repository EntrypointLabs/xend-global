export type CheckoutMode = "popup" | "redirect";

export interface LaunchParams {
  nonce: string;
  mode: CheckoutMode;
  /**
   * The merchant page's own origin, so the checkout posts the result back to
   * the page that opened it rather than to whichever allowed origin the
   * Merchant registered first. The backend only honours it when it is on the
   * Merchant's allowlist.
   */
  opener?: string;
}

/**
 * Cryptographic, synchronous nonce. Generated BEFORE window.open so the
 * open call carries no awaited work ahead of it (transient activation
 * does not survive an await; the iOS Safari popup block).
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function applyLaunchParams(url: URL, opts: LaunchParams): void {
  url.searchParams.set("nonce", opts.nonce);
  url.searchParams.set("mode", opts.mode);
  if (opts.opener) url.searchParams.set("opener", opts.opener);
}

/**
 * The intent-less initial URL the popup opens to synchronously, before
 * the intent exists: `?nonce=<n>&mode=popup[&opener=<origin>]`. Phase 5's
 * LoadingShell tolerates this load and waits for the navigation to the
 * full URL.
 */
export function buildLaunchUrl(
  checkoutOrigin: string,
  opts: LaunchParams,
): string {
  const url = new URL(checkoutOrigin);
  applyLaunchParams(url, opts);
  return url.toString();
}

/**
 * The full launch URL Phase 5's launch.ts parses. The query key for the
 * intent reference is `intent` (not intentRef); shape is exactly
 * `?intent=<reference>&nonce=<nonce>&mode=<popup|redirect>[&opener=<origin>]`.
 * This is the ONLY place that builds a launch URL carrying an intent.
 */
export function buildCheckoutUrl(
  checkoutOrigin: string,
  opts: LaunchParams & { reference: string },
): string {
  const url = new URL(checkoutOrigin);
  url.searchParams.set("intent", opts.reference);
  applyLaunchParams(url, opts);
  return url.toString();
}

/**
 * The merchant page's origin as the checkout should hear it. A sandboxed or
 * file: page reports the opaque "null" origin, which no allowlist can carry,
 * so it is left off and the backend falls back to the Merchant's first
 * allowed origin.
 */
export function openerOrigin(): string | undefined {
  const origin = window.location.origin;
  return origin && origin !== "null" ? origin : undefined;
}

/**
 * Open the checkout popup synchronously. MUST be called inside the click
 * handler with no awaited work before it. Returns the window handle, or
 * null if the popup was blocked.
 */
export function openCheckoutWindow(
  checkoutOrigin: string,
  nonce: string,
  opener?: string,
): Window | null {
  return window.open(
    buildLaunchUrl(checkoutOrigin, { nonce, mode: "popup", opener }),
    "xend-checkout",
    "popup,width=420,height=640",
  );
}

/** Navigate the already-open popup to the full URL once the intent exists. */
export function navigatePopup(win: Window, url: string): void {
  win.location.href = url;
}

/** Full-page redirect for the fallback flow. */
export function redirectTo(url: string): void {
  window.location.assign(url);
}
