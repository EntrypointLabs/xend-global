# PR #100 review sweeps

## Sweep 1

Implemented:

- Normalize mainnet at the Checkout boundary and reject unsupported execution networks before authorization.
- Backfill pre-migration nonterminal intents at application startup, where the deployment's validated network is known.
- Rewind Activity replay to the confirmed Payment slot when newer webhooks have advanced the bookmark.
- Count settling Payments in the Merchant dashboard and use one exact Merchant USDC formatter; expose a symbol-free Checkout amount formatter.
- Use the advisory-lock connection for all protected database work, including calls through dependent services. PostgreSQL tests saturate a two-connection pool with eight retries.
- Preserve Merchant identity provider outages (502), malformed identities (422), and configuration errors (503); map missing receiving accounts to 409 during key issuance.
- Confirm ATA creation before verifying ownership.
- Require the Consumer's valid signature over the pinned message for terminal and already-settling retries, without broadcasting again.
- Separate Blockradar pricing behind the provider interface, validate its documented pair and response shape, reject out-of-band reference rates, and coalesce/cache recent positive quotes.
- Quarantine pinned attempts with unknown broadcast outcomes without publishing payment.failed; serialize the reaper with submission.
- Reserve capacity and insert authorization/attempt rows in one PostgreSQL transaction, eliminating the separate Redis/database commit gap.
- Keep the public summary GET read-only and reject zero-amount Merchant requests during validation.
- Exercise enabled/disabled devnet key gates with key-specific configuration fixtures.
- Deduplicate React resolution in the Merchant Vite/test graph to fix the CI hook failures.

Disagreements:

- **Exact debit disclosure:** intentional consent behavior. The Consumer must see the exact USDC debit before signing. The reference-bearing summary is designed to expose this amount; the implied reference rate is not a secret in this product contract.
- **Mandatory portal guard refactor:** every current handler authenticates provider identity and scopes access to the owner. The absence of a Nest controller guard is not an existing unauthenticated endpoint. Keep the current ownership boundary and its regression tests; a guard refactor is a future maintainability choice.
- **Duplicate service-level idempotency amount comparison:** the Merchant API already hashes the full original request and rejects conflicting replays with 409. Comparing a freshly calculated settlement amount inside the lower service can also reject a legitimate replay after an FX change. Keep the existing request-level contract.

## Capacity migration deployment

Migration 0044 changes capacity storage from Redis to PostgreSQL so daily/monthly capacity and Payment authorization can commit or roll back together. Session velocity remains in Redis. The migration seeds existing live authorization usage from payment_intents.

Stop old authorization writers before applying 0044, then start only the new backend. A rolling mixture of old Redis-based writers and new PostgreSQL-based writers is unsupported. Do not clear old counters or restart the old backend after the cutover without reconciling usage. No production migration is executed by this review task.

Pinned attempts marked ATTEMPT_ORPHAN_SUSPECTED require investigation of the actual chain outcome. Missing Activity or elapsed time alone must never be treated as proof that payment failed.

## Sweep 2

Implemented:

- Align Merchant and Checkout with the root React 19.2.3 runtime, removing the workspace-local React copies that caused invalid hook calls after a clean `npm ci`.
- Forward the requested opener through the Cloudflare CSP lookup and cache by intent plus opener, preserving multi-origin embeds while keeping the public summary GET read-only.
- Reuse the already verified Merchant identity and committed profile row when returning registration and profile-update dashboards.
- Synchronize the business profile form when a newer profile version arrives.
- Add the final Drizzle schema snapshot and verify that a subsequent generation reports no schema changes.
- Run the Blockradar readiness probe through `BlockradarFxAdapter`.
- Reject Merchant-owned USDC refunds before inserting a refund row, route reversals by the recorded provider, and map the provider-layer unsupported-refund error to 409.

Disagreements: none. The bot's suggestion to restore opener persistence was not used because that would reintroduce an unauthenticated write on GET; forwarding the opener to the existing backend allowlist check preserves the required CSP behavior without the side effect.

## Sweep 3

Implemented:

- Include the Kafka consumer group in process-local retry keys so webhook and Activity subscriptions cannot reset or combine each other's attempts for the same topic offset.
- Defer Payment intent transition metrics until the surrounding PostgreSQL transaction commits; rolled-back transitions no longer increment durable-state metrics.
- Filter settling, claimed-settlement, and authorized-attempt background sweeps by the deployment's Solana cluster before querying chain state or reaping attempts.

Disagreements: none.

## Sweep 4

Implemented:

- Add a bounded, cluster-scoped repair sweep over durable Payment rows that still lack confirmed Activity, so RPC/indexer outages remain repairable after Kafka exhausts and dead-letters the original event.
- Keep devnet Payments on the real settlement path while reporting `livemode: false` and routing their webhook endpoint management and deliveries through test mode.
- Bind settlement destinations and newly issued execution keys to the active Solana cluster; mismatched destinations are rejected on settlement and reprovisioned during onboarding.
- Keep the current Merchant dashboard mounted while a refreshed identity token revalidates, preserving unsaved form drafts through token rotation.

Disagreements: none.

## Sweep 5

Implemented:

- Scope Merchant portal settlement destinations and Payment history to the active Solana cluster.
- Preserve dirty business-profile drafts when a token refresh or another session delivers a newer profile version; pristine forms still synchronize automatically.
- Return an authenticated failed Payment as its signed terminal result when Checkout authorization is replayed after a lost response.
- Atomically retire a pinned, unbroadcast attempt whose quote expires, transition the intent to `expired`, release its capacity reservation, and publish `payment.expired`.
- Keep the Merchant name and amount visible when mobile submission fails or confirmation times out, while disabling unsafe retries after a signed Payment may have been submitted.
- Allow owning Merchants to read legacy terminal intents whose pre-migration execution cluster is null.

Disagreements: none.
