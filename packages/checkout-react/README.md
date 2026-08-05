# @xend/checkout-react

React wrapper for the Pay with Xend button. It wraps
[`@xend/checkout-core`](https://www.npmjs.com/package/@xend/checkout-core) and
carries the same security and brand guarantees: exact-origin result
matching, nonce correlation, redirect fallback for in-app webviews, and the
brand-compliant button. No popup, postMessage, or nonce logic is
reimplemented here.

## The one rule

**The browser result is NOT settlement truth. Confirm every payment
server-side** off the signed webhook (`@xend/checkout-core/webhook`) or
`GET /payments/:id`. The `onResult` callback carries only a reference and a
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

Changing callback props (like `onResult`) does not remount the button, so an
in-flight payment is never interrupted by a re-render.
