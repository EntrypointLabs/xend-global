# Pay with Xend: Integration Quickstart

Status: pilot
Author: Pay with Xend, 2026-07-11
Scope: how a pilot merchant adds the Pay with Xend button, creates a payment intent on their server, and confirms payment from the signed webhook. Runs end to end on devnet test mode. The server-side intent and webhook contracts are owned by the Pay with Xend merchant API (see the merchant API reference and ADR 0017); this guide cross-references them rather than restating field shapes.

## The one rule, first

**Fulfill on the webhook or on `GET /payments/:id`, never on the browser callback.** The button hands your page a reference and a status only. It carries no amount and no verified flag, on purpose: a browser message can be forged, so it can never be settlement truth. Ship the order when your server sees a verified `payment.succeeded` webhook (or reads the payment back and sees it succeeded), not when `onResult` fires.

## 1. Add the button

### Script tag

```html
<div id="pay"></div>
<script src="https://unpkg.com/@xend/checkout-core/dist/xend-checkout.iife.js"></script>
<script>
  XendCheckout.mountXendButton({
    checkoutOrigin: "https://pay.xend.global",
    mount: document.getElementById("pay"),
    createIntent: async () => {
      const res = await fetch("/api/pay/intent", { method: "POST" });
      return res.json(); // { reference }
    },
    onResult: (result) => {
      // { reference, status }. Confirm server-side before fulfilling.
      window.location.assign("/order/pending?ref=" + result.reference);
    },
  });
</script>
```

### npm (React)

```bash
npm install @xend/checkout-react react
```

```tsx
import { XendPayButton } from "@xend/checkout-react";

<XendPayButton
  checkoutOrigin="https://pay.xend.global"
  createIntent={async () =>
    (await fetch("/api/pay/intent", { method: "POST" })).json()
  }
  onResult={(result) => {
    // { reference, status }. Confirm server-side before fulfilling.
  }}
/>;
```

The plain npm entry (`@xend/checkout-core`) exposes `mountXendButton` for non-React apps.

## 2. Create the intent on your server

Money never travels through the browser, so `createIntent` calls your own server, and your server calls the Pay with Xend merchant API. Create the intent with `POST /v1/payment_intents` (amount is a minor-unit string, currency is `NGN` or `USDC`); the response's `id` is what you hand back to the browser as the SDK's `{ reference }`. The full request and response shapes are the merchant API's contract (Phase 6 merchant API reference).

"Your server" is any server-side execution context, not necessarily a standalone REST route. A route handler works, and in React a Server Action works just as well and is usually cleaner. The only rule is that the call runs server-side, where your secret key is safe and the amount is resolved from your own data.

### A standalone route

```ts
// Your server. XEND_SECRET_KEY is a server-only secret, never shipped to the browser.
app.post("/api/pay/intent", async (req, res) => {
  const resp = await fetch("https://api.xend.global/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.XEND_SECRET_KEY}`,
      "content-type": "application/json",
    },
    // Amount (minor units, as a string) and currency live here, server-side.
    body: JSON.stringify({ amount: "500000", currency: "NGN" }),
  });
  const intent = await resp.json(); // { id: "pi_...", ... }
  res.json({ reference: intent.id }); // the SDK's createIntent needs { reference }
});
```

### A Next.js Server Action

You do not need a separate route. A Server Action runs on the server, so your secret key never reaches the browser, yet the button can call it straight from `createIntent`. This is the recommended path for React apps.

```ts
// app/actions/pay.ts
"use server";

export async function createXendIntent(cartId: string) {
  // Resolve the amount on the server from your own data, keyed on an id the
  // shopper cannot tamper with. See the caveat below.
  const cart = await getCart(cartId);

  const res = await fetch("https://api.xend.global/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.XEND_SECRET_KEY}`,
      "content-type": "application/json",
    },
    // amount is a minor-unit string; currency is "NGN" or "USDC".
    body: JSON.stringify({ amount: String(cart.totalMinor), currency: "NGN" }),
  });
  const intent = await res.json(); // { id: "pi_...", ... }
  return { reference: intent.id }; // the SDK's createIntent contract
}
```

```tsx
// A client component renders the button and calls the action on click.
"use client";
import { XendPayButton } from "@xend/checkout-react";
import { createXendIntent } from "../actions/pay";

export function Checkout({ cartId }: { cartId: string }) {
  return (
    <XendPayButton
      checkoutOrigin="https://pay.xend.global"
      createIntent={() => createXendIntent(cartId)}
      onResult={(result) => {
        // { reference, status }. Confirm server-side before fulfilling.
      }}
    />
  );
}
```

**Pass an identifier, never the amount.** A Server Action is callable from the client, so treat its arguments as untrusted input, exactly like a route body. Hand it a cart or order id and look the price up on the server. If the client passes the amount directly (`createXendIntent(4500000)`), it is tamperable again and the server-authoritative guarantee is gone.

A Server Component can instead create the intent at render time and pass the `reference` down as a prop, which skips the click round-trip. A Server Component cannot be the click handler itself, so for the on-click `createIntent` path use a Server Action or a route handler.

## 3. Verify the webhook and fulfill

Webhooks are the settlement truth. Verify every delivery with the zero-dependency helper on the Node entry.

```ts
import express from "express";
import {
  verifyWebhook,
  WebhookVerificationError,
} from "@xend/checkout-core/webhook";

const app = express();

// You MUST verify over the raw request bytes. Re-serialized JSON breaks the
// signature. In Express, capture the raw body:
app.post(
  "/api/pay/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    let event;
    try {
      // req.body is a Buffer here (raw bytes). The whsec_ secret is used whole.
      event = verifyWebhook(
        req.body,
        req.headers,
        process.env.XEND_WEBHOOK_SECRET,
      );
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        return res.status(400).send(err.code);
      }
      throw err;
    }

    // Dedup on the event id INSIDE the verified payload, never on the
    // Xend-Event-Id header (that header is unsigned convenience only).
    if (alreadyProcessed(event.id)) return res.status(200).end();

    if (event.type === "payment.succeeded") {
      fulfill(event.data.reference); // ship the order here, not in onResult
      markProcessed(event.id);
    }
    res.status(200).end();
  },
);
```

Notes that keep this correct:

- The `Xend-Signature` header carries `t=<unix>,v1=<hex>[,v1=<hex>]`. The helper HMACs `timestamp.rawBody`, checks the 300 second replay window against the header's `t=`, and accepts any matching `v1` (multiple appear during a secret rotation, so rotation is a non-event).
- `verifyWebhook` throws `WebhookVerificationError` with a `code` (`MISSING_HEADERS`, `MALFORMED_HEADER`, `TIMESTAMP_OUT_OF_TOLERANCE`, `INVALID_SIGNATURE`) on any failure; return 400 so the sender retries or alerts.
- Delivery is at least once and unordered. Your handler must be idempotent, keyed on the signed body's event id.
- Every event carries a `livemode` marker. Test-mode events (devnet) have `livemode: false`; do not fulfill real goods off a test event.

## 4. Confirm without a webhook

If you would rather pull than listen, read the payment back from `GET /payments/:id` using the `reference` and fulfill when it reports succeeded. This is the same settlement truth as the webhook. Do not trust the browser `onResult` status for fulfillment either way.

## 5. Host page requirements

- **COOP.** Do not send a strict `Cross-Origin-Opener-Policy`. Use `same-origin-allow-popups` or no COOP header, so the popup keeps its opener handle and can post the result back. A strict COOP severs the channel; the SDK then reports `unresolved` and the shopper still completes through the return URL, but you lose the live callback.
- **Webviews and Opera Mini.** Inside an in-app browser (Instagram, WhatsApp, and similar), inside Opera Mini, or when the popup is blocked, the SDK does not open a dead popup. It runs the full-page redirect flow (`mode=redirect`) and returns the shopper to your return URL. Handle `onUnresolved` (reasons `redirected`, `popup_blocked`, `popup_closed`) by showing a pending state and confirming server-side.

## 6. Callback statuses

`onResult` reports one of `succeeded`, `failed`, `canceled`, or `expired` (single-l `canceled`). A popup closed with no result arrives through `onUnresolved`, not as a failure. Treat all of these as hints for the shopper's screen only, never as the fulfillment trigger.

## 7. Devnet test-mode walkthrough

1. Use a test-mode secret key and webhook secret from your Pay with Xend dashboard.
2. Add the button with `createIntent` pointing at your `/api/pay/intent` route.
3. Fund a test Consumer in test mode.
4. Open your page in a normal browser, tap Pay with Xend, and complete the payment in the popup.
5. Watch `onResult` fire with `status: "succeeded"` and `reference` set.
6. Confirm your webhook endpoint received `payment.succeeded`, that `verifyWebhook` returned the payload, and that your handler fulfilled once (idempotent on the event id).
7. Repeat inside an in-app webview to confirm the redirect flow returns the shopper to your return URL and `onUnresolved` fires with reason `redirected`.

When all seven steps pass on devnet test mode, the integration is ready for a live-mode key.
