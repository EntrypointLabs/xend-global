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

## Banking adapters and unified funding (2026-09-09)

Actual implementations are under `banking/`: Nomba collection/payout and Paga subsidiary accounts/payout, behind `BankAccountProvider` and `BankPayoutProvider`. They do not advertise conversion capability. `BankingRegistry` is registered in FiatModule; authenticated `GET /fiat/banking/capabilities` shows configured sandbox providers. Set `FIAT_BANKING_PROVIDERS=nomba` for credential-free Nomba exploration; Paga additionally needs its three `PAGA_SANDBOX_*` keys. These are developer capabilities, not consumer money execution endpoints. Production remains disabled.

`funding/funding-planner.ts` values separate NGN/USDC holdings and funds sends from destination currency first, requesting an executable quote only for the shortfall. `planSendAll` accounts for fees and all available source holdings. Display valuation is indicative, not a spend quote. `funding/funding-state.ts` tracks the conversion and final send separately, requires trusted reconciliation, preserves converted funds after final-send failure, and rejects fixture/webhook evidence as settlement.

Run from the repository root:

```sh
# Offline example: NGN 500000 + USDC 100, direct and combined sends, fees and send-all
node apps/backend/scripts/demo-unified-funding.cjs

# Actual Nomba adapter against the provider's public sandbox; no real money
node apps/backend/scripts/probe-nomba-adapter.cjs

# Both adapters plus shared funding rules and workflow tests
npm test --workspace @xend/backend -- --runInBand src/fiat/banking src/fiat/funding
```

Nomba's actual adapter probe accepted account creation and payout submission as fixtures, then rejected inconsistent transaction requery. Its public sandbox cannot prove production settlement or idempotency. Paga's tests mock documented HTTP contracts because authenticated sandbox keys remain unavailable. The Paga subsidiary debit and Business bank payout are separate treasury legs; do not submit the second by repeating the first after a timeout. Sandbox operation evidence is always fixture, including a matched Paga requery. No NGN/USDC conversion endpoint is invented.

The isolated unified simulation below now connects mobile balance, receive, quote, reservation and background execution. Real reconciliation-to-ledger posting, live conversion and final SpendService integration still need implementation and provider evidence. Existing consumer Balance remains chain-backed.

`funding/funding-store.ts` adds PostgreSQL-backed reservation intents: locked reconciled holdings, atomic reservations, owner-scoped idempotency, pinned provider/destination/action references and immutable stored plans. `funding-store.sql` is an isolated-test schema initializer, not an applied production migration. Fresh reconciled holdings are required for new intents. Provider execution, reconciliation posting and terminal reservation release are not wired into this store yet; do not expose it as a live consumer send endpoint. Integration tests use `FIAT_PG_TEST_DATABASE_URL` and clean up only their randomly named schema.

## Complete unified simulation

`unified/` connects authenticated HTTP endpoints, isolated PostgreSQL holdings, the shared funding planner and a three-second background worker. Migration `0042_unified_fiat_simulation.sql` creates its separate table. Both migrations have been applied locally. Set `FIAT_UNIFIED_SIMULATION=true` in the backend environment and restart the backend. Production rejects this flow regardless of the flag.

In a mobile development build, open Receive or Send → Fiat → **Test unified NGN + USDC balance**. The screen lives at `apps/mobile/app/(fiat)/unified.tsx`. Its balances are test holdings, separate from real Cash and the Solana vault.

1. Receive `500000` NGN and `100` USDC. Select USD display: the estimated total is `400.00 USD` using this workbench's fixed fixture rate, not a market price.
2. Preview a `600000` NGN send to a synthetic destination. It reserves the existing `500000` NGN and converts only the `100000` NGN shortfall from USDC. Confirm once; the worker advances conversion and delivery, and the screen polls activity.
3. Alternatively, from those original holdings, preview `150` USDC: it spends `100` USDC directly and converts enough NGN for the remaining `50` USDC. Send All quotes the combined available holdings. Fixture fees are zero; the shared planner supports explicit fees.
4. Enable manual test steps before confirmation to inject failures. A failure before conversion releases the original reservations. After conversion, failure releases the payout reservation and retains the converted destination currency. Restarting the backend preserves holdings, orders and automatic execution.

Routes are `GET /fiat/unified`, `POST /fiat/unified/receive`, `POST /fiat/unified/quotes`, `POST /fiat/unified/orders`, and `POST /fiat/unified/orders/:id/advance`. All require Consumer authentication and derive ownership on the server. Amounts are integer strings in minor units. Mutations are idempotent; holdings and reservations change under an owner row lock. Quotes bind destination and plan, expire after ten minutes, and are checked again when reserving funds.

This workbench proves the application workflow without sending bank or blockchain transactions. It does not create a usable virtual account or establish a provider conversion route. Its aggregate storage is intentionally isolated from the production reservation store; enabling real execution requires verified provider reconciliation and the existing SpendService authorization flow.

Run mobile contracts with both `utils/__tests__/fiat.test.ts` and `utils/__tests__/unified-fiat.test.ts`. The HTTP/PostgreSQL suite is `src/fiat/unified/unified.pg.spec.ts`, enabled with `FIAT_PG_TEST_DATABASE_URL`; it creates and removes an isolated test schema. Native device visual testing remains separate.

## Durable execution groundwork (2026-09-09)

The production-oriented funding store now atomically applies reconciled events to holdings, reservations, intent state and an append-only journal. Conversion source debit and destination credit are separate observations. Destination credit is fully reserved until both sides are confirmed; a failed final payout retains converted funds. Unknown outcomes retain reservations. Reused settlement evidence and conflicting event retries are rejected.

`funding/funding-executor.ts` coordinates one execution/reconciliation step using pinned provider ports. Read-only readiness checks require valid quotes and, for USDC, a persisted transfer binding with required signatures before claiming payout. An atomic started-event claim permits only one automatic submission attempt. A timeout or crash after that claim requires requery using the same reference; it never silently repeats an uncertain payment. Ports must authenticate and match actual evidence. There are no default executable ports and this executor is not scheduled or HTTP-exposed.

`funding/funding-spend.bridge.ts` prepares a vault spend through the existing TransferService/SpendService, retaining its transfer intent and approval requirements. It verifies the authenticated owner and pinned vault, network, mint, beneficiary and amount. It refuses the login-free simulator identity. This is preparation only: durable linkage to the returned transfer intent, signed submission and chain reconciliation must be connected before exposing it.

These are internal components, not a declaration of real-money readiness. The funding SQL remains an isolated integration-test initializer, not a production migration. Live deposit ingestion, account provisioning, executable conversion, concrete execution ports, authorized transfer binding and production rollout remain outstanding. The public sandbox probe evidence is in `docs/specs/public-fiat-sandbox-probes.md`.

The simulator currency cards now show available funds (settled minus reserved), with reservations labelled separately. An NGN-only conversion regression checks the intermediate and final balances so converted funds cannot appear spendable twice.

## Provider-backed Naira account provisioning

`banking/accounts.service.ts` now calls a credentialed sandbox adapter and stores its actual response per owner/provider/environment. GET/POST `/fiat/banking/accounts` are Consumer-authenticated. Local simulator mode uses the explicit `/dev/fiat/banking/accounts` route and its loopback-only guard; this still calls the provider sandbox, never the unified simulator. In the mobile test screen select **Provider sandbox: Naira account**. The standalone account screen also appears in the normal fiat screen.

Paga is the current local integration target; Nomba is on hold. Select `FIAT_BANKING_PROVIDERS=paga` and `FIAT_NGN_ACCOUNT_PROVIDER=paga` with the three `PAGA_SANDBOX_*` credentials in the ignored backend environment. No keys appear in the mobile bundle. Before creating accounts, run this read-only check from the repository root:

```sh
node --env-file=apps/backend/.env apps/backend/scripts/probe-paga-adapter.cjs
```

Once an owned sandbox account exists, append `--account=ACCOUNT_REFERENCE` to verify retrieval and its actual balance. The script only permits the two official sandbox hosts and read operations, and omits identities, balances and secrets from its report.

Migrations0043 and0044 have been applied locally: ownership uniqueness, persisted create claims, and an active external account number cannot be assigned to two users for one provider/environment. Unknown outcomes stay `needs_attention`; a page refresh never repeats account creation. The optional BVN and submitted identity fields are forwarded to the provider but are not stored in this provisioning table. A returned account does not establish regulatory eligibility or prove deposits/payouts settle.

HTTP/PostgreSQL tests exercise persistence and request concurrency with controlled provider responses. Configuration presence alone does not prove access: on 2026-09-09 at 22:33 UTC, both tested Paga APIs rejected the configured keys with HTTP 401. No official sandbox account or money movement has been verified. The account endpoint's `available` flag currently describes configured capability, not a successful provider authentication check.

For a timed-out creation, use **Check account status** in the mobile account screen. `POST /fiat/banking/accounts/reconcile` (or its guarded `/dev` equivalent) takes `{accountId}` and reads the provider using the owner's persisted account reference. A matched active account is saved without submitting another creation or changing balances. Unknown accounts, authentication failures and identity/uniqueness conflicts retain `needs_attention`; this action cannot repair a request that never created an account. Concurrent failed reads cannot undo another successful recovery. The current verification is 303 backend fiat tests, including isolated PostgreSQL suites, and 15 mobile contract tests; provider boundaries in automated tests use controlled responses.

## Observed balances and Paga NGN transfers

The mobile account screens now call `GET /fiat/balances` to read an owned Paga account and owned Solana vault through the provider API and RPC. These observations are not simulator credits or ledger reservations. Missing balances remain null. Sandbox bank holdings are never combined with mainnet tokens. Any displayed USD total is an indicative quote, not executable USDC settlement.

`GET /fiat/banking/transfers`, `POST /fiat/banking/transfers/quotes` and `POST /fiat/banking/transfers` connect the Paga subsidiary-account transfer path. Both source and recipient must be active owned Xend Paga accounts. Source ownership is derived from the session; the recipient is checked with Paga before preview. Submission checks the provider balance, persists a stable claim and calls the documented transfer endpoint once. Matched exact source debit and destination credit permit sandbox completion; uncertain outcomes retain `needs_attention` and block another outgoing submission until reconciled. Fees remain unknown rather than being fabricated as zero.

The local-only developer routes use the `/dev` prefix and the existing explicit guard. Open **Naira account → Send to another Xend Paga account**. Migration0045 for durable transfer intents has been applied locally. Provider credentials and two provisioned sandbox accounts are needed to run the actual external transfer; the HTTP/PG integration tests use controlled provider responses and do not prove tenant settlement.

Fonbnk development is parked. Its existing code is retained, but it is not the selected implementation path or a dependency of observed balances. Nomba and Paga adapters are prepared separately for branch review, with shared mobile/API/persistence code merged on an integration branch. Cross-asset execution, external NGN bank payouts and funded end-to-end verification remain required before declaring the goal complete.
