# Fonbnk sandbox orders

`FonbnkSandboxOrders` implements the documented v2 create, read by order ID, recovery by application reference, and funding confirmation calls for NGN ↔ Solana devnet USDC. This is a provider client, not a credited balance or an enabled consumer route.

## Verified access on 2026-09-09

`node apps/backend/scripts/probe-fonbnk-order-permissions.mjs` called the official sandbox confirmation endpoint with a non-issued all-zero order ID. The configured credentials returned HTTP 403 and the documented feature-permission denial. No user, order, or payment was created. Empty-body create returned 400 validation first, which does not establish permission.

Fonbnk must enable **create-users permission** for this merchant account. Their current docs explicitly say the same gate covers create/confirm/cancel, KYC, and user authentication. `GET /api/v2/user/kyc` creates an end user when the email is unknown; it is not a harmless discovery probe.

Sources: [Create order](https://docs.fonbnk.com/server-to-server/api-endpoints/create-order), [KYC lookup](https://docs.fonbnk.com/server-to-server/api-endpoints/get-user-kyc-state).

## Integration contract

1. Obtain a real authenticated customer's verified email/country and observed IP. Resolve the receiving vault on the server, and complete the provider's KYC precheck. Do not fabricate sandbox identities.
2. Get and persist the accepted quote with customer fields, destination, and a unique `orderParams` in `FonbnkOrderBinding`. Acquire a durable submit-once execution claim before calling `create`.
3. Display the returned manual funding instructions. On crypto deposits, `funding` contains the provider address, exact source amount, and explicitly pinned `solana-devnet` network and mint.
4. Fund through authorized bank execution or the existing SpendService flow. This client does not debit a vault or move naira.
5. Call `confirm` after funding; crypto confirmation needs the observed Solana transaction signature. Poll `get` and reconcile provider results against bank or chain evidence before changing settled holdings.
6. If creation times out, recover with `findByReference`. `orderParams` is searchable but **not documented as an idempotency key**; do not automatically create again when lookup is empty. Confirmation checks current status first because the provider rejects duplicate confirmation.

Sources: [Get order](https://docs.fonbnk.com/server-to-server/api-endpoints/get-order), [Confirm order](https://docs.fonbnk.com/server-to-server/api-endpoints/confirm-order).

## Deliberate boundaries

- Only sandbox credentials and the official sandbox host; production runtime is rejected.
- Only manual NGN bank and Solana devnet USDC order shapes are accepted. Other payment interactions need their own implementation.
- Matching includes customer, reference, exact quote debit/credit, currency pair, devnet mint, submitted bank/wallet details, and funding amount.
- Output evidence is `provider_sandbox`, never proof of bank or chain settlement. Even a provider-reported successful payout requires independent reconciliation before ledger credit.
- Only `payout_successful` and `refund_successful` are terminal. Expired, canceled, and invalid deposits can later recover; failed payouts/refunds can retry. They must remain reconcilable and cannot release reservations on status name alone.
- Existing `FonbnkFiatProvider` routes still advertise order execution unavailable. Wiring them requires durable binding, KYC, the account permission, and funding/settlement integration above.

Source: [Order statuses](https://docs.fonbnk.com/server-to-server/order-statuses).

Validation: 26 mocked transport contract tests cover both directions, strict matching, expiration, timeout recovery, confirmation replay, lifecycle finality, and sandbox-only gates. These do not prove a funded provider order.
