# @prydd/checkout-react

## 0.2.0

### Minor Changes

- 31b4fb9: The hosted checkout now lives at `https://prydd.co/pay`, so shoppers sign in
  with the passkey they already use in the Prydd app. `checkoutOrigin` is
  replaced by an optional `checkoutUrl` (default `https://prydd.co/pay`), and
  `apiBase` defaults to `https://api.prydd.co`, so a button needs only
  `createIntent` and `onResult`. The default presentation is now `"modal"`: the
  sheet on your page plus a Prydd window, because Prydd's wallet provider will
  not load inside another site's page.

### Patch Changes

- Updated dependencies [31b4fb9]
- Updated dependencies [397b9b8]
  - @prydd/checkout-core@0.2.0

## 0.1.1

### Patch Changes

- c2c477b: First release published through npm trusted publishing. No code changes.
- Updated dependencies [c2c477b]
  - @prydd/checkout-core@0.1.1

## 0.1.0

### Minor Changes

- 9a61779: The default inline presentation now opens straight into Prydd's own payment
  sheet instead of asking the shopper to confirm on the merchant page first, so a
  payment is one tap plus the passkey. The embedded sheet follows the merchant
  sheet's light or dark theme.
- b4fc223: First published release of the Pay with Prydd browser SDK.

  The button mounts against a merchant's publishable key, opens the hosted
  checkout in a popup, and hands the page back a reference and a status. Popup is
  the default presentation and redirect is honoured for in-app browsers. The
  result envelope carries no amount and no verified flag on purpose: fulfilment
  belongs to the signed webhook, and `verifyWebhook` in `@prydd/checkout-core/webhook`
  checks it. The React package wraps the same core with `presentation` and `theme`
  props.

### Patch Changes

- 80d04b4: The hosted checkout is now `https://pay.prydd.co` and the API is
  `https://api.prydd.co`. Examples and documentation name the new hosts. Messages
  from the checkout are matched against `checkoutOrigin` by strict equality, so an
  integration still passing the old origin has to update it.
- Updated dependencies [9a61779]
- Updated dependencies [52c8ff6]
- Updated dependencies [80d04b4]
- Updated dependencies [b4fc223]
  - @prydd/checkout-core@0.1.0
