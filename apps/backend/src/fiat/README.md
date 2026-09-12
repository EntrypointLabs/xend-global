# Consumer fiat integration

The first slice supports authenticated quotes and durable simulated Receive/Send orders. It does not transfer money. Fonbnk is one quote adapter, not the data model or mobile API.

## Boundaries

- `FiatProvider` owns provider discovery, quote normalization and the future execution port. Money crosses it as integer strings with currency and decimals. Provider references remain opaque strings.
- `FiatProviderRegistry` selects enabled adapters. A provider outage does not hide another provider's working route. Each existing quote/order pins provider, environment and route; failover never moves an in-flight order to another provider.
- `FiatService` owns validation, idempotency and workflow rules. `FiatStore` isolates persistence; `PgFiatStore` uses PostgreSQL with unique keys and transactional event reduction.
- `FiatController` accepts Consumer-authenticated requests. No client-selected owner, wallet destination, verification status or provider status is trusted.
- The mobile screen uses the normalized contract only. It has no provider credentials, SDKs or signing shortcuts.

## Local preview

Set `FIAT_ENABLED_PROVIDERS=simulator,fonbnk` in backend `.env`. Set Fonbnk's sandbox credential pair separately if using its quote preview. Restart the backend after configuration changes. Open Receive → Naira or Send → Bank transfer (the option labels may evolve).

The simulator uses a fixed NGN 1500/USDC price and returns no usable bank/payment address. Simulated payments never update the real Balance or existing chain Activity. It supports payment received, completion, pre-funding failure, post-funding return, expiry and late-receipt review. Orders and updates survive restart. A creation left uncertain for 30 seconds becomes `needs_attention` when read, rather than being silently retried. Expired awaiting-payment orders become expired on read; late receipts remain reviewable.

Fonbnk performs real authenticated sandbox discovery/limits/quotes. Its order capability is false because the current sandbox account returns 403 at order creation. No Fonbnk order or KYC mutation is made from the app.

All fiat routes are disabled in production in this slice, even if test providers are configured. Existing records can be inspected but cannot be simulated in production. The registry's production gate must be deliberately replaced with verified per-provider production eligibility when live execution is implemented; changing environment variables alone is insufficient.

## Adding or replacing a provider

1. Implement `FiatProvider` in `providers/`. Translate provider fields, errors, exact amounts and network/mint identity there. Reject unsupported required fields or ambiguous money units.
2. Advertise only proven capabilities; quote-only is valid. Temporary bank account, permanent account, fiat holding and third-party receipt are independent claims. A shared/manual bank instruction is not a temporary account.
3. Register the adapter under `FIAT_PROVIDERS` in `fiat.module.ts`, and enable its name in server configuration. Do not add vendor branches in the service, mobile screen or schema.
4. Run the same service/store tests with its normalized fixtures, adapter contract tests and authenticated sandbox proof. Check min/max/step, quote expiry, fees, KYC, refunds and account permissions.
5. Keep the old adapter available for its existing orders until those are terminal/reconciled. Disable its new route selection separately when introducing a production routing policy.

No provider swap should require rewriting the screens or changing stored order columns. Matching API capability is still necessary: a quote adapter cannot substitute for actual collection, verification or bank settlement. Business onboarding time is outside this code's control.

## Before real execution

The service currently rejects every non-simulation order, independently of adapter flags. Remove that restriction only after implementing server-resolved vault destinations, direction-specific verification, provider order reconciliation, authenticated webhook inbox, and chain evidence. USDC debits must use the existing SpendService with all Consumer/presence proofs and message binding preserved. Provider payout completion is separate from chain debit confirmation. Returns must be observed before claiming money restored.

These are still open: permanent/temporary account issuance, Sumsub hosted flow, actual NGN holding/manual conversion, direct fiat-to-fiat, provider webhooks, real Spend preparation/submission, and real chain/bank Activity linkage. The current simulator validates the workflow but does not prove those integrations. Merchant Checkout/settlement has not changed.

## Validation

- Backend tests: `npm test --workspace @xend/backend -- --runInBand src/fiat`.
- Mobile contract tests: `npm test --workspace @xend/mobile -- --runInBand utils/__tests__/fiat.test.ts`.
- PostgreSQL HTTP test: supply `FIAT_PG_TEST_DATABASE_URL` via a secret environment, run `src/fiat/fiat.pg.spec.ts` from the backend workspace. It creates and removes a unique isolated schema; auth is explicitly mocked only in that test. Tests cover concurrent creates, update dedupe, changed payloads, ownership, restart and return state.
- `npm run check-types` checks the workspace.
- `apps/backend/scripts/probe-fonbnk.mjs` independently exercises the sandbox API without orders or fund movement.

The local development migration has been applied. No remote environment was migrated or deployed.
