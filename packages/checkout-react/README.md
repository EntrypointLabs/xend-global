# @xend/checkout-react

React wrapper for the Pay with Xend button. It wraps
[`@xend/checkout-core`](https://www.npmjs.com/package/@xend/checkout-core) and
carries the same security and brand guarantees: the checkout sheet with its
inline ceremony, exact-origin result matching, nonce correlation, the popup and
redirect fallbacks, and the brand-compliant button. No sheet, frame, popup,
postMessage, or nonce logic is reimplemented here.

## The one rule

**The browser result is NOT settlement truth. Confirm every payment
server-side** off the signed webhook (`@xend/checkout-core/webhook`) or
`GET /v1/payment_intents/:id`. The `onResult` callback carries only a reference and a
status.

## Install

```bash
npm install @xend/checkout-react react
```

`react` is a peer dependency (>=18).

## Usage

```tsx
import { XendPayButton } from "@xend/checkout-react";

export function Checkout() {
  return (
    <XendPayButton
      checkoutOrigin="https://pay.xend.global"
      apiBase="https://api.xend.global"
      createIntent={async () => {
        // Call YOUR server, which creates the intent. Money never travels
        // through the browser.
        const res = await fetch("/api/xend/intent", { method: "POST" });
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
name and amount, read from `apiBase`; tapping Pay swaps the sheet's body for
Xend's hosted checkout in a cross-origin frame, so the passkey ceremony runs on
Xend's own origin with no second window. If that frame cannot run, the popup
takes over behind the same sheet automatically, keeping the same nonce and
reference.

**Register every origin you mount the button on** with Xend, on your
Merchant's allowed origins list. Xend only lets a registered origin frame the
checkout, and only a registered origin receives the result.

Changing callback props (like `onResult`) does not remount the button, so an
in-flight payment is never interrupted by a re-render. `presentation`
(`"iframe"` default, or `"modal"` / `"popup"` / `"redirect"`), `apiBase` and
`theme` (`"auto"`, `"light"`, `"dark"`) are mount-time options and do remount
it. Without an `apiBase` the sheet has no summary to show, so `"iframe"` and
`"modal"` degrade to `"popup"`.
