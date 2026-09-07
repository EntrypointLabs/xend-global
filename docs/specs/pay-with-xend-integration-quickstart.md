# Pay with Xend: Integration Quickstart

Status: pilot
Author: Pay with Xend, 2026-07-11 (revised 2026-09-07)
Scope: how a pilot merchant adds the Pay with Xend button, creates a payment intent on their server, and confirms payment from the signed webhook. Runs end to end on devnet test mode. The server-side intent and webhook contracts are owned by the Pay with Xend merchant API (see ADR 0017); this guide states the shapes the API serves today.

Throughout, `XEND_API_BASE` is the base URL of the Pay with Xend merchant API you were given with your keys (the checkout's own API for the pilot environment). The hosted checkout is `https://pay.xend.global`.

## The one rule, first

**Fulfill on the webhook or on `GET /v1/payment_intents/:id`, never on the browser callback.** The button hands your page a reference and a status only. It carries no amount and no verified flag, on purpose: a browser message can be forged, so it can never be settlement truth. Ship the order when your server sees a verified `payment.succeeded` webhook (or reads the intent back and sees `status: "succeeded"`), not when `onResult` fires.

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

### Options

- `presentation`: `"popup"` (default) opens the hosted checkout in its own window and relays the result back to your page; `"redirect"` navigates the whole page and returns the shopper to the intent's `return_url`. In-app webviews, Opera Mini and blocked popups redirect on their own whichever you chose.
- `theme`: `"auto"` (default) follows the viewer's colour scheme; `"light"` and `"dark"` pin the button's material.

### Register every origin the button lives on

The popup posts its result back to the exact origin of the page that opened it. That origin has to be on your Merchant's allowed-origins list (set up with your keys), and the list may hold more than one, so a storefront on `https://shop.example.com` and a checkout on `https://eu.shop.example.com` both hear their own results. An origin that is not on the list is ignored and the result goes to the first registered one.

## 2. Create the intent on your server

Money never travels through the browser, so `createIntent` calls your own server, and your server calls the Pay with Xend merchant API. Create the intent with `POST /v1/payment_intents`; the response's `id` is what you hand back to the browser as the SDK's `{ reference }`.

"Your server" is any server-side execution context, not necessarily a standalone REST route. A route handler works, and in React a Server Action works just as well and is usually cleaner. The only rule is that the call runs server-side, where your secret key is safe and the amount is resolved from your own data.

### Amount and currency

`amount` is always an integer string in the smallest unit of `currency`, and the API answers in the same currency and unit you sent:

| `currency` | `amount` is in               | Example                        |
| ---------- | ---------------------------- | ------------------------------ |
| `NGN`      | kobo (2 decimals)            | `"800000"` is ₦8,000.00        |
| `USDC`     | USDC base units (6 decimals) | `"25000000"` is 25.000000 USDC |

An NGN intent pins an executable FX quote at creation and settles in USDC; the response's `usdc_settlement_raw` is that settlement amount (always 6-decimal USDC base units) and `fx_rate`, `fx_source`, `fx_quoted_at` describe the quote. A USDC intent has no rate to pin: `amount` and `usdc_settlement_raw` are the same number and the FX fields are `null`. The shopper is shown a price in NGN or in dollars at the checkout, but what you read back is what you sent.

### Request and response

```http
POST /v1/payment_intents
Authorization: Bearer <XEND_SECRET_KEY>
Idempotency-Key: <unique per attempt, recommended>
Content-Type: application/json

{
  "amount": "800000",
  "currency": "NGN",
  "merchant_reference": "A-2043",
  "return_url": "https://shop.example.com/pay/return",
  "cancel_url": "https://shop.example.com/pay/cancel",
  "metadata": { "order_id": "A-2043", "customer": "cus_9x" }
}
```

```json
{
  "id": "pi_...",
  "object": "payment_intent",
  "status": "created",
  "currency": "NGN",
  "amount": "800000",
  "usdc_settlement_raw": "500000",
  "fx_rate": "1600.00",
  "fx_source": "pilot-static",
  "fx_quoted_at": "2026-09-07T10:00:00.000Z",
  "expires_at": "2026-09-07T10:30:00.000Z",
  "merchant_reference": "A-2043",
  "return_url": "https://shop.example.com/pay/return",
  "cancel_url": "https://shop.example.com/pay/cancel",
  "livemode": false,
  "created": 1788948000,
  "metadata": { "order_id": "A-2043", "customer": "cus_9x" }
}
```

- `metadata` is an optional flat map of string keys to string values. It is stored with the intent and returned on every read of it. It is not included in webhook payloads today: look the intent up by `data.object.intent_id` if you need it there.
- `return_url` and `cancel_url` must be public https URLs; the checkout appends a signed status to them on redirect completion.
- `Idempotency-Key` makes a retried create return the original intent instead of a second one. Reusing a key with a different body is a `409 IDEMPOTENCY_KEY_REUSE`.

### A standalone route

```ts
// Your server. XEND_SECRET_KEY is a server-only secret, never shipped to the browser.
app.post("/api/pay/intent", async (req, res) => {
  const resp = await fetch(`${process.env.XEND_API_BASE}/v1/payment_intents`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.XEND_SECRET_KEY}`,
      "content-type": "application/json",
    },
    // Amount (smallest unit, as a string) and currency live here, server-side.
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

  const res = await fetch(`${process.env.XEND_API_BASE}/v1/payment_intents`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.XEND_SECRET_KEY}`,
      "content-type": "application/json",
    },
    // amount is kobo for NGN, 6-decimal base units for USDC.
    body: JSON.stringify({
      amount: String(cart.totalKobo),
      currency: "NGN",
      metadata: { cart_id: cartId },
    }),
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
      fulfill(event.data.object.intent_id); // ship the order here, not in onResult
      markProcessed(event.id);
    }
    res.status(200).end();
  },
);
```

The event body:

```json
{
  "id": "evt_...",
  "object": "event",
  "type": "payment.succeeded",
  "created": 1788948120,
  "livemode": false,
  "correlation_id": "pi_...",
  "data": {
    "object": {
      "id": "pay_...",
      "intent_id": "pi_...",
      "status": "succeeded",
      "currency": "NGN",
      "amount": "800000",
      "usdc_settlement_raw": "500000",
      "merchant_reference": "A-2043",
      "tx_signature": "...",
      "settled_at": "2026-09-07T10:02:00.000Z",
      "occurred_at": "2026-09-07T10:02:01.000Z",
      "settlement": {
        "provider": "direct_usdc",
        "currency": "USDC",
        "status": "complete",
        "completed_at": "2026-09-07T10:02:00.000Z",
        "provider_reference": null,
        "ngn_settled_minor": null
      }
    }
  }
}
```

Notes that keep this correct:

- The intent id is `data.object.intent_id`; `data.object.id` is the settled payment's own id. Match on `intent_id`, which is the `reference` your page saw.
- `data.object.currency` and `amount` are what the shopper was shown: for an NGN intent that is the kobo figure you sent; for a USDC intent it is the dollar figure in cents (`"USD"`, `"2500"`), not the base units you sent. `usdc_settlement_raw` is always the settlement amount in 6-decimal USDC base units. Reconcile on `intent_id` and `usdc_settlement_raw`, or read the intent back.
- Event types are `payment.succeeded`, `payment.failed` and `payment.expired`.
- The `Xend-Signature` header carries `t=<unix>,v1=<hex>[,v1=<hex>]`. The helper HMACs `timestamp.rawBody`, checks the 300 second replay window against the header's `t=`, and accepts any matching `v1` (multiple appear during a secret rotation, so rotation is a non-event).
- `verifyWebhook` throws `WebhookVerificationError` with a `code` (`MISSING_HEADERS`, `MALFORMED_HEADER`, `TIMESTAMP_OUT_OF_TOLERANCE`, `INVALID_SIGNATURE`) on any failure; return 400 so the sender retries or alerts.
- Delivery is at least once and unordered. Your handler must be idempotent, keyed on the signed body's event id.
- Every event carries a `livemode` marker. Test-mode events (devnet) have `livemode: false`; do not fulfill real goods off a test event.

## 4. Confirm without a webhook

If you would rather pull than listen, read the intent back with `GET /v1/payment_intents/:id` (the same bearer key) using the `reference`, and fulfill when `status` is `succeeded`. This is the same settlement truth as the webhook. Do not trust the browser `onResult` status for fulfillment either way.

```http
GET /v1/payment_intents/pi_...
Authorization: Bearer <XEND_SECRET_KEY>
```

The response is the payment intent object from section 2, with `status` advanced. Intents are scoped to the key that created them and its mode: a live key never sees a test intent, and an id from another Merchant reads as `404 INTENT_NOT_FOUND`.

## 5. Refunds

Refunds are ops-initiated for the pilot: ask the Pay with Xend team, who reverse the settled payment back to the shopper's Account, in full or in part, at the live rate at refund time. Every refund request carries an `Idempotency-Key` and is refused without one (`400 IDEMPOTENCY_KEY_REQUIRED`); a retry with the same key returns the original refund and never reverses twice, and two different keys against the same payment are decided one after the other against the remaining refundable amount. The merchant console's refund screen will call the same path.

## 6. Host page requirements

- **COOP.** Do not send a strict `Cross-Origin-Opener-Policy`. Use `same-origin-allow-popups` or no COOP header, so the popup keeps its opener handle and can post the result back. A strict COOP severs the channel; the SDK then reports `unresolved` and the shopper still completes through the return URL, but you lose the live callback.
- **Webviews and Opera Mini.** Inside an in-app browser (Instagram, WhatsApp, and similar), inside Opera Mini, or when the popup is blocked, the SDK does not open a dead popup. It runs the full-page redirect flow (`mode=redirect`) and returns the shopper to your return URL. Handle `onUnresolved` (reasons `redirected`, `popup_blocked`, `popup_closed`) by showing a pending state and confirming server-side.

## 7. Callback statuses

`onResult` reports one of `succeeded`, `failed`, `canceled`, or `expired` (single-l `canceled`). A popup closed with no result arrives through `onUnresolved`, not as a failure. Treat all of these as hints for the shopper's screen only, never as the fulfillment trigger.

## 8. Keys

Test keys (`xnd_test_...`) are issued as soon as you are onboarded. Live keys (`xnd_live_...`) require a verified business (KYB) and a provisioned settlement endpoint, and stay live only while that verification stands: a live key on a Merchant whose verification is withdrawn answers `403 KYB_NOT_VERIFIED` on every request until it is restored. A key that leaks can be revoked on request; the next request with it answers `401 INVALID_API_KEY`.

## 9. Devnet test-mode walkthrough

1. Use a test-mode secret key and webhook secret from your Pay with Xend dashboard.
2. Add the button with `createIntent` pointing at your `/api/pay/intent` route.
3. Fund a test Consumer in test mode.
4. Open your page in a normal browser, tap Pay with Xend, and complete the payment in the popup.
5. Watch `onResult` fire with `status: "succeeded"` and `reference` set.
6. Confirm your webhook endpoint received `payment.succeeded`, that `verifyWebhook` returned the payload, and that your handler fulfilled once (idempotent on the event id).
7. Repeat inside an in-app webview to confirm the redirect flow returns the shopper to your return URL and `onUnresolved` fires with reason `redirected`.

When all seven steps pass on devnet test mode, the integration is ready for a live-mode key.
