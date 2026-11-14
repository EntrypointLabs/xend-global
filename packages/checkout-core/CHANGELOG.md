# @prydd/checkout-core

## 0.1.0

### Minor Changes

- b4fc223: First published release of the Pay with Prydd browser SDK.

  The button mounts against a merchant's publishable key, opens the hosted
  checkout in a popup, and hands the page back a reference and a status. Popup is
  the default presentation and redirect is honoured for in-app browsers. The
  result envelope carries no amount and no verified flag on purpose: fulfilment
  belongs to the signed webhook, and `verifyWebhook` in `@prydd/checkout-core/webhook`
  checks it. The React package wraps the same core with `presentation` and `theme`
  props.

### Patch Changes

- 52c8ff6: The Pay with Prydd button now shows the Prydd symbol instead of the old X mark.
- 80d04b4: The hosted checkout is now `https://pay.prydd.co` and the API is
  `https://api.prydd.co`. Examples and documentation name the new hosts. Messages
  from the checkout are matched against `checkoutOrigin` by strict equality, so an
  integration still passing the old origin has to update it.
