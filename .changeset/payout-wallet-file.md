---
"@prydd/checkout-core": minor
---

Adds `@prydd/checkout-core/payout`, which serves the payout wallet file at
`/.well-known/prydd.json`. Prydd now reads a Merchant's payout wallet from the
Merchant's own site and refuses to pay any other wallet, so every store must
publish this file before shoppers can pay it.
