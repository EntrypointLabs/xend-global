---
"@prydd/checkout-core": minor
"@prydd/checkout-react": minor
---

The hosted checkout now lives at `https://prydd.co/pay`, so shoppers sign in
with the passkey they already use in the Prydd app. `checkoutOrigin` is
replaced by an optional `checkoutUrl` (default `https://prydd.co/pay`), and
`apiBase` defaults to `https://api.prydd.co`, so a button needs only
`createIntent` and `onResult`. The default presentation is now `"modal"`: the
sheet on your page plus a Prydd window, because Prydd's wallet provider will
not load inside another site's page.
