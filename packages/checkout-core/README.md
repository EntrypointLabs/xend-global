# @prydd/checkout-core

Framework-agnostic Pay with Prydd button and result relay. Zero runtime
dependencies. Renders a brand-compliant button, draws the checkout sheet on
your page, runs the passkey ceremony inline on Prydd's own origin without
opening a second window, and relays a result back. A separate Node entry ships
the webhook verification helper.

## The one rule

**The browser result is NOT settlement truth. Confirm every payment
server-side** off the signed webhook (`@prydd/checkout-core/webhook`) or
`GET /v1/payment_intents/:id`. The `onResult` callback intentionally carries only a
reference and a status, no amount and no verified flag, so a tampered
browser message can never be mistaken for a completed payment.

## Install

Script tag (the minified IIFE exposes `window.PryddCheckout`):

```html
<script src="https://unpkg.com/@prydd/checkout-core/dist/prydd-checkout.iife.js"></script>
<div id="pay"></div>
<script>
  PryddCheckout.mountPryddButton({
    mount: document.getElementById("pay"),
    createIntent: async () => {
      // Call YOUR server, which creates the intent. Money never travels
      // through the browser.
      const res = await fetch("/api/prydd/intent", { method: "POST" });
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
npm install @prydd/checkout-core
```

```ts
import { mountPryddButton } from "@prydd/checkout-core";
```

## How the sheet works

Tapping the button draws a sheet on your page with your store name and the
amount, read from the Prydd API. Tapping Pay opens Prydd's hosted checkout at
`https://prydd.co/pay` in a small window, where the shopper confirms with the
passkey they already use in the Prydd app (Face ID, Touch ID or their phone).
The result comes back to your page over an exact-origin postMessage channel,
correlated by nonce and intent reference, and the sheet shows the outcome.

The checkout lives on prydd.co because passkeys made in the Prydd app belong
to prydd.co, and browsers only offer a passkey to pages on the domain it was
made for.

Payments above the shopper's daily one-signature limit are approved on their
phone: the checkout window waits for that approval and finishes on its own.

## What you have to do

**Register every origin you mount the button on** with Prydd, on your
Merchant's allowed origins list. The checkout only posts its result to a
registered origin.

**Publish your payout wallet** on the same site. The Prydd app and checkout
read it from `https://<your domain>/.well-known/prydd.json` and refuse to pay
any other wallet, so a Payment can only reach the wallet your own site names.
Until the file is there, shoppers cannot pay you. Serve it from a route
handler with the SDK:

```ts
// app/.well-known/prydd.json/route.ts (Next.js; any Fetch API server works)
import { payoutWalletResponse } from "@prydd/checkout-core/payout";

export const dynamic = "force-dynamic";

export function GET() {
  return payoutWalletResponse({
    mainnet: process.env.PRYDD_PAYOUT_WALLET_MAINNET,
  });
}
```

Use the wallet you registered with Prydd. `payoutWalletResponse` refuses a
value that is not a Solana address, and serves the file with
`Access-Control-Allow-Origin: *` so the checkout can read it. A static file
with the same body and header works too:

```json
{ "payoutWallets": { "mainnet": "<your wallet address>" } }
```

## Options

- `presentation`: `"modal"` (default) draws the sheet and opens the checkout
  in a Prydd window. `"popup"` opens that window straight from the button with
  no sheet. `"redirect"` navigates the whole page. `"iframe"` runs the
  checkout inside the sheet, but Prydd's wallet provider will not load under
  another site's page, so it only suits pages Prydd controls. Webviews, Opera
  Mini and blocked popups fall back to redirect on their own, and any value
  the SDK does not recognise falls back to `"popup"`.
- `checkoutUrl`: where the hosted checkout lives. Defaults to
  `"https://prydd.co/pay"`; override it only for local development.
- `apiBase`: origin of the Prydd API. Defaults to `"https://api.prydd.co"`.
- `theme`: `"auto"` (default) follows the viewer's colour scheme; `"light"`
  and `"dark"` pin the material.

## Security posture

- **Exact-origin only.** Results are accepted solely from a strict-equality
  match on the origin of `checkoutUrl`. Substring or prefix look-alikes and a `null`
  origin are rejected.
- **Reference and nonce matched.** Each open generates a fresh cryptographic
  nonce; a result must carry both the intent reference and that nonce.
- **The frame is locked down.** It is sandboxed to scripts, forms and its own
  origin, and the only permission granted to it is
  `publickey-credentials-get`, which is what lets the passkey ceremony run
  there at all.
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
face should self-host or link Inter Display. The Prydd mark ships as a tiny
inline SVG.

## COOP requirement

The popup remains the fallback channel, so the merchant page must not send a
strict `Cross-Origin-Opener-Policy`. Use `same-origin-allow-popups` or no COOP
header so the popup keeps its opener handle. Strict COOP severs the channel
and the flow falls back to the redirect result path.
