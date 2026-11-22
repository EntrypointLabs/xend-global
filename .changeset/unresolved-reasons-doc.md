---
"@prydd/checkout-core": patch
---

Documents what each `onUnresolved` reason means and that a merchant must not
navigate on `redirected` or `popup_blocked`, because that cancels the redirect
to Prydd's checkout.
