# @prydd/checkout-react

React wrapper for the Pay with Prydd button. It wraps
[`@prydd/checkout-core`](https://www.npmjs.com/package/@prydd/checkout-core) and
carries the same security and brand guarantees: the checkout sheet with its
inline ceremony, exact-origin result matching, nonce correlation, the popup and
redirect fallbacks, and the brand-compliant button. No sheet, frame, popup,
postMessage, or nonce logic is reimplemented here.

## The one rule

**The browser result is NOT settlement truth. Confirm every payment
server-side** off the signed webhook (`@prydd/checkout-core/webhook`) or
`GET /v1/payment_intents/:id`. The `onResult` callback carries only a reference and a
status.

## Install

```bash
npm install @prydd/checkout-react react
```

`react` is a peer dependency (>=18).

## Usage

```tsx
import { PryddPayButton } from "@prydd/checkout-react";

export function Checkout() {
  return (
    <PryddPayButton
      createIntent={async () => {
        // Call YOUR server, which creates the intent. Money never travels
        // through the browser.
        const res = await fetch("/api/prydd/intent", { method: "POST" });
        return res.json(); // { reference }
      }}
      onResult={(result) => {
        // { reference, status } only. Confirm server-side before fulfilling.
      }}
    />
  );
}
```

Tapping the button draws the checkout sheet on your page with the merchant
name and amount; tapping Pay opens Prydd's hosted checkout at
`https://prydd.co/pay` in a small window, where the shopper confirms with the
passkey they already use in the Prydd app.

**Register every origin you mount the button on** with Prydd, on your
Merchant's allowed origins list. Only a registered origin receives the result.

Changing callback props (like `onResult`) does not remount the button, so an
in-flight payment is never interrupted by a re-render. `presentation`
(`"modal"` default, or `"popup"` / `"redirect"` / `"iframe"`), `checkoutUrl`
(default `https://prydd.co/pay`), `apiBase` (default `https://api.prydd.co`)
and `theme` (`"auto"`, `"light"`, `"dark"`) are mount-time options and do
remount it.
