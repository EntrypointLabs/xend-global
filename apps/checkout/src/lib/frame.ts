/**
 * Whether the surface is running inside a merchant's iframe rather than a popup
 * or a redirected tab. The frame relationship is a browser fact rather than a
 * launch parameter the merchant page controls, so it is what decides the
 * Session carrier and the postMessage target.
 */
export function isFramed(): boolean {
  return window.parent !== window;
}
