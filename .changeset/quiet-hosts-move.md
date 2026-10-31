---
"@prydd/checkout-core": patch
"@prydd/checkout-react": patch
---

The hosted checkout is now `https://pay.prydd.co` and the API is
`https://api.prydd.co`. Examples and documentation name the new hosts. Messages
from the checkout are matched against `checkoutOrigin` by strict equality, so an
integration still passing the old origin has to update it.
