---
"@xend/checkout-core": minor
"@xend/checkout-react": minor
---

First published release of the Pay with Xend browser SDK.

The button mounts against a merchant's publishable key, opens the hosted
checkout in a popup, and hands the page back a reference and a status. Popup is
the default presentation and redirect is honoured for in-app browsers. The
result envelope carries no amount and no verified flag on purpose: fulfilment
belongs to the signed webhook, and `verifyWebhook` in `@xend/checkout-core/webhook`
checks it. The React package wraps the same core with `presentation` and `theme`
props.
