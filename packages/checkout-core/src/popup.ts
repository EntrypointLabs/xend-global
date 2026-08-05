export type CheckoutMode = "popup" | "redirect";

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

/**
 * The intent-less initial URL the popup opens to synchronously, before
 * the intent exists: `?nonce=<n>&mode=popup`. Phase 5's LoadingShell
 * tolerates this load and waits for the navigation to the full URL.
 */
export function buildLaunchUrl(
  checkoutOrigin: string,
  opts: { nonce: string; mode: CheckoutMode },
): string {
  const url = new URL(checkoutOrigin);
  url.searchParams.set("nonce", opts.nonce);
  url.searchParams.set("mode", opts.mode);
  return url.toString();
}

/**
 * The full launch URL Phase 5's launch.ts parses. The query key for the
 * intent reference is `intent` (not intentRef); shape is exactly
 * `?intent=<reference>&nonce=<nonce>&mode=<popup|redirect>`. This is the
 * ONLY place that builds a launch URL carrying an intent.
 */
export function buildCheckoutUrl(
  checkoutOrigin: string,
  opts: { reference: string; nonce: string; mode: CheckoutMode },
): string {
  const url = new URL(checkoutOrigin);
  url.searchParams.set("intent", opts.reference);
  url.searchParams.set("nonce", opts.nonce);
  url.searchParams.set("mode", opts.mode);
  return url.toString();
}

/**
 * Open the checkout popup synchronously. MUST be called inside the click
 * handler with no awaited work before it. Returns the window handle, or
 * null if the popup was blocked.
 */
export function openCheckoutWindow(
  checkoutOrigin: string,
  nonce: string,
): Window | null {
  return window.open(
    buildLaunchUrl(checkoutOrigin, { nonce, mode: "popup" }),
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
