# @xend/checkout-core

Framework-agnostic Pay with Xend button and result relay. Zero runtime
dependencies. Renders a brand-compliant button, draws the checkout sheet on
your page, runs the passkey ceremony on Xend's own origin, and relays a result
back. A separate Node entry ships the webhook verification helper.

## The one rule

**The browser result is NOT settlement truth. Confirm every payment
server-side** off the signed webhook (`@xend/checkout-core/webhook`) or
`GET /v1/payment_intents/:id`. The `onResult` callback intentionally carries only a
reference and a status, no amount and no verified flag, so a tampered
browser message can never be mistaken for a completed payment.

## Install

Script tag (the minified IIFE exposes `window.XendCheckout`):

```html
<script src="https://unpkg.com/@xend/checkout-core/dist/xend-checkout.iife.js"></script>
<div id="pay"></div>
<script>
  XendCheckout.mountXendButton({
    checkoutOrigin: "https://pay.xend.global",
    apiBase: "https://api.xend.global",
    mount: document.getElementById("pay"),
    createIntent: async () => {
      // Call YOUR server, which creates the intent. Money never travels
      // through the browser.
      const res = await fetch("/api/xend/intent", { method: "POST" });
      return res.json(); // { reference }
    },
    onResult: (result) => {
      // result: { reference, status }. Confirm server-side before fulfilling.
    },
  });
</script>
```

npm:

```bash
npm install @xend/checkout-core
```

```ts
import { mountXendButton } from "@xend/checkout-core";
```

## How the sheet works

Tapping the button draws a sheet on your page showing the merchant name and
the amount, read from `GET /checkout/intents/:reference` on `apiBase`. Tapping
Pay opens Xend's hosted checkout in a window, synchronously inside that click,
and the sheet waits there while the shopper's Face ID or fingerprint runs on
Xend's origin. The result comes back over the same exact-origin postMessage
channel the popup flow uses.

The sheet never authenticates, never signs, and never reads a balance. It is
the interface; Xend's own origin is the ceremony.

## Options

- `presentation`: `"modal"` (default) draws the sheet. `"popup"` opens the
  hosted checkout straight from the button with no sheet. `"redirect"`
  navigates the whole page. Webviews, Opera Mini and blocked popups fall back
  to redirect on their own.
- `apiBase`: origin of the Xend API, e.g. `"https://api.xend.global"`. The
  sheet reads the intent summary from it; without one, `"modal"` degrades to
  `"popup"`. Every origin you mount the button on must be allowed to read that
  endpoint cross-origin.
- `theme`: `"auto"` (default) follows the viewer's colour scheme; `"light"`
  and `"dark"` pin the material.

The checkout posts its result back to the origin of the page that opened it,
so every origin the button is mounted on must be on your Merchant's allowed
origins list.

## Security posture

- **Exact-origin only.** Results are accepted solely from a strict-equality
  match on `checkoutOrigin`. Substring or prefix look-alikes and a `null`
  origin are rejected.
- **Reference and nonce matched.** Each open generates a fresh cryptographic
  nonce; a result must carry both the intent reference and that nonce.
- **Redirect fallback.** In an in-app webview, in Opera Mini, or when the
  popup is blocked, the SDK opens the full-page redirect flow instead of
  leaving a dead popup or a stranded sheet.
- **The sheet is display only.** It renders the merchant name and the pinned
  display amount as text, never as markup, and holds no credential.
- **Popup closed is not failed.** If the popup closes with no result, the
  SDK reports `unresolved` (check server-side), never a false failure.

## Brand note

The button uses Inter Display Medium with system fallbacks. The font is
referenced, not bundled, to keep the script small; hosts that want the exact
face should self-host or link Inter Display. The Xend mark ships as a tiny
inline SVG.

## COOP requirement

The merchant page must not send a strict `Cross-Origin-Opener-Policy`. Use
`same-origin-allow-popups` or no COOP header so the popup keeps its opener
handle. Strict COOP severs the channel and the flow falls back to the
redirect result path.
