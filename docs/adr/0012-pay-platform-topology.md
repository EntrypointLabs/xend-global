# 0012: Pay platform topology: managed Kafka + Redis, extracted fee-payer relayer, modular-monolith core

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Founder (infra decision, clarification round 2026-07-11) + planning session
**Tags:** backend, infrastructure, pay

## Context and Problem Statement

The Pay platform (an embedded checkout button any online store can place next to card and Apple Pay, see `.claude/plans/pay-with-xend/PROJECT.md`) introduces two capabilities the current backend has never needed. First, a Payment moves through a lifecycle (created, authorized, settling, succeeded or failed) whose transitions other services must observe: the webhook dispatcher that signals merchants, the future read model that renders Payments in a Consumer's Activity, and later underwriting that reads Payment history. Second, merchant-scoped Sessions and per-Consumer/per-merchant rate-limit counters need fast shared state that survives a process restart and is visible to more than one deployable.

Today the repo is a single NestJS application (`apps/backend`) with no message broker and no cache. Payment-shaped state has no home: the closest precedent, transfer intent state, is held in memory at `apps/backend/src/transfer/transfer.service.ts:37-83` and does not survive a restart. No ADR constrains backend service boundaries; all twelve existing ADRs (0000 through 0011) cover styling, mobile, Expo, and provider anti-lock-in, none the shape of the Pay services about to land.

This ADR records the platform topology before any Pay service code is written, so every later phase builds on known ground.

## Decision Drivers

- Payment lifecycle transitions have multiple observers (webhook dispatcher, Activity read model, later underwriting), and a durable, replayable event history is a first-class asset, not incidental logging.
- Sessions and rate-limit counters need low-latency shared state readable by both the API and the separately deployed relayer, and must survive process restarts.
- Handoff alignment: the original platform handoff specified a Kafka + Redis stack; a Postgres-only pilot would need a later migration to reach it.
- Fail-loud config posture: infrastructure the platform depends on is validated at boot through the existing Joi env schema (`apps/backend/src/config/config.module.ts`), the same posture as `DATABASE_URL`.
- Anti-lock-in seam discipline (the Grid incident, ratified in [ADR-0010](./0010-no-load-bearing-provider.md)): a vendor SDK lives behind exactly one owned adapter, and swapping a managed broker or cache must not ripple into business modules.
- PROJECT.md success criterion: one correlation ID must trace a Payment across every service, so a cross-service correlation contract is load-bearing from day one.
- Solo-operator cost: at one-merchant pilot scale, every additional managed service is a real bill and a real operations surface, so the honest downside must be recorded.

## Considered Options

1. **Managed Kafka + managed Redis now** (the full handoff stack): a managed Kafka-compatible broker carries payment lifecycle events; managed Redis holds Sessions and rate-limit counters; docker-compose provides the local equivalents.
2. **Postgres-only pilot** (the research recommendation, see `.claude/plans/pay-with-xend/research/ARCHITECTURE.md` section 1): a transactional outbox plus pg-boss for eventing and Postgres tables for Sessions and counters, adding no new infrastructure at pilot scale.
3. **Redis-only middle path**: managed Redis for Sessions and rate limits, a Postgres transactional outbox for events, deferring a broker until a second consumer service exists.

## Decision Outcome

Chosen option: **"Managed Kafka + managed Redis now"**, per founder decision 2026-07-11, explicitly overriding the research recommendation of the Postgres-only pilot (option 2). The delta, stated plainly and not argued: research recommended Postgres-only to avoid two managed dependencies at pilot scale, and the founder chose the full stack now to avoid a later migration and to align with the handoff topology. This ADR records that decision honestly; it does not relitigate it.

The topology this ratifies:

**Kafka carries payment lifecycle events.** The topic names are contracts from day one (renaming one after a consumer exists is a breaking change), so the catalog is fixed here:

- `payment.created`
- `payment.authorized`
- `payment.settling`
- `payment.succeeded`
- `payment.failed`
- `payment.expired`
- `session.issued`
- `session.revoked`
- `payout.initiated`
- `payout.completed`
- `refund.recorded`

`payment.succeeded` is the event the merchant webhook dispatcher treats as the settlement truth signal (see the Success Criteria in PROJECT.md).

**Redis holds Session state and rate-limit counters.** Phase 2 consumes it; this phase provisions it and confirms the backend connects at boot.

**Deployment shape:** managed cloud services in production, docker-compose for local development. The lead candidate for the cache is Redis Cloud (essentials tier); the lead candidates for the broker are Redpanda Cloud Serverless or Confluent Cloud Basic. The final vendor is confirmed at provisioning (see the closing checkpoint task in the phase plan), and if it differs from these leads it is recorded here under a later Update note. Secrets flow through the existing Joi env schema (`apps/backend/src/config/config.module.ts`); no secret is committed to the repo.

**Module boundaries:** everything Pay-related is a NestJS module inside `apps/backend` (identity-and-capability, merchant, checkout, settlement, and the webhook dispatcher), with one exception. The fee-payer relayer is a separate deployable with its own environment. Its fee-payer key never enters `apps/backend`'s environment, and it accepts calls only from the Identity and Capability API over an authenticated internal channel. New authorization primitives (merchant API keys, merchant-scoped Sessions) are built beside the existing Consumer JWT, not on top of it: a merchant credential is a different trust domain from a Consumer's login and must not inherit Consumer-JWT assumptions.

**Vendor seam rule (restated from [ADR-0010](./0010-no-load-bearing-provider.md)):** no vendor SDK is imported outside its single owned adapter (the pattern at `apps/backend/src/wallet/wallet-provider.interface.ts:16`). This is the Grid-incident rule and it is review-blocking. It extends to the broker and cache clients: their libraries are confined to the events and redis modules respectively.

**Correlation-ID contract:** every service propagates the `X-Correlation-Id` header. In-process the value is carried through AsyncLocalStorage; a cuid2 is minted when an inbound request arrives without one; and once a Payment intent ID exists it becomes the correlation ID, so a single ID follows one Payment end to end. Every deployable, the relayer included, must require and echo this header. This is the load-bearing cross-service contract behind PROJECT.md's success criterion that one correlation ID traces a Payment across every service. The middleware and CORS work in this same phase implement the API side of this contract.

**CORS/COOP header policy:** the backend grants CORS only to an explicit origin allowlist read from `CORS_ALLOWED_ORIGINS` (implemented in this phase, replacing the previous wide-open `enableCors()`). Separately, the future Checkout app at `pay.xend.global` must never be served with `Cross-Origin-Opener-Policy: same-origin`: that header severs `window.opener` and kills the popup postMessage channel the canonical checkout flow depends on. Merchants who need COOP on their own pages are documented to use `same-origin-allow-popups`, which preserves the opener relationship.

### Consequences

- **Good:** No later migration off a pilot-only eventing design. The event backbone the platform will run on at scale is the one it runs on from the first Payment.
- **Good:** Topology matches the platform handoff, so there is no divergence to reconcile when subsequent workstreams land.
- **Good:** Replayable event history. Payment lifecycle events persist in the log and can be re-consumed by a new service (the Activity read model, later underwriting) without replaying HTTP calls.
- **Good:** Shared, restart-surviving state for Sessions and rate limits, readable by both the API and the separately deployed relayer.
- **Bad:** Two additional managed-service bills and two additional operations surfaces for a solo operator at one-merchant pilot scale, which is exactly the cost the research recommendation sought to avoid.
- **Bad:** Kafka has no second consumer service yet. In this phase and the next, the broker is provisioned and produced to before anything downstream consumes it, so its full value is deferred.
- **Bad:** Local development now requires docker-compose to be running for the backend to boot, since `REDIS_URL` and `KAFKA_BROKERS` are required (fail-loud) config.

## Pros and Cons of the Options

### Managed Kafka + managed Redis now

- ✅ No later migration; the pilot runs on the target architecture.
- ✅ Durable, replayable event history and a natural home for future consumers.
- ✅ Fast shared Session and rate-limit state across the API and the relayer.
- ❌ Two managed dependencies (bills and operations surfaces) before the workload justifies them.
- ❌ The broker has no consumer yet, so its value is deferred a phase or two.

### Postgres-only pilot

- ✅ Zero new infrastructure; the existing Postgres carries eventing (outbox + pg-boss) and state.
- ✅ Lowest cost and operations burden at one-merchant scale.
- ❌ A later migration to the handoff stack once a second consumer or higher throughput arrives, touching the code that produces and consumes events.
- ❌ Diverges from the handoff topology, leaving a reconciliation debt.

### Redis-only middle path

- ✅ Solves the Session and rate-limit state need immediately with one managed dependency.
- ✅ Keeps eventing in Postgres (outbox) until a real second consumer exists.
- ❌ Still requires a broker migration later, so it only partially avoids the Postgres-only downside.
- ❌ Splits the mental model (Redis for state, Postgres for events) without removing the eventual Kafka adoption.

## More Information

- `.claude/plans/pay-with-xend/PROJECT.md` (vision, locked decisions of 2026-07-11, and the success criteria this topology serves)
- `.claude/plans/pay-with-xend/research/ARCHITECTURE.md` (section 1, the Postgres-only recommendation this ADR overrides)
- `.claude/plans/pay-with-xend/STATE.md` (codebase state and integration points)
- [ADR-0010](./0010-no-load-bearing-provider.md) (the owned-interface anti-lock-in rule this ADR extends to the broker and cache)
- `apps/backend/src/config/config.module.ts` (the Joi env schema that validates the infra secrets at boot)
- `apps/backend/src/wallet/wallet-provider.interface.ts` (the adapter-seam pattern the vendor rule references)

This ADR supersedes nothing.

## Update 2026-07-12 (relayer facts surfaced during Phase 3 build)

Three clarifications from building the fee-payer relayer (`apps/relayer`). These are notes, not a reversal; the topology above stands.

1. **The co-sign instruction allowlist deliberately EXCLUDES the System program.** The relayer co-signs only ComputeBudget, SPL Token (a single `TransferChecked`), and idempotent Associated-Token-create instructions. Research listed System for settlement-account creation, but a System lamport transfer from the fee payer is precisely the drain vector a fee sponsor must refuse. Settlement-account provisioning is a separate Phase 4 ops path, funded outside the payment hot path, and is never co-signed here. The fee payer is additionally rejected if it appears as a writable account in any instruction (so a fee-payer-funded ATA create is refused, closing the rent-refund farming vector).

2. **The relayer has the smallest possible credential surface.** It gets NO Postgres, Drizzle, Kafka, or Redis client or credential; its complete credential inventory is its fee-payer key, its own Helius RPC access, and its internal-auth secret. Payment lifecycle events and domain state remain owned by the Identity and Capability API and the settlement layer, which call the relayer and record the returned signature. Consequently the relayer's per-Consumer / per-merchant / global caps and its per-intent replay guard are in-memory and single-instance for the pilot; the Redis re-introduction trigger recorded above (and in `research/ARCHITECTURE.md` 1.4) applies to the relayer's caps when it scales past one instance. The authoritative single-live-attempt guard is Phase 4's `payment_attempts` partial unique index, not the relayer's replay guard.

3. **Kora adopt-vs-build spike outcome ratified: build a thin NestJS relayer.** The timeboxed spike (`docs/specs/relayer-kora-adopt-vs-build.md`) chose to build a thin NestJS relayer over adopting the Solana Foundation's Kora, on solo-operator ops burden, with Kora as the documented alternative. The relayer's allowlist / caps / fee-ceiling design is expressed as one typed config object (`apps/relayer/src/relayer-config.ts`) whose fields map one-to-one onto Kora's config, so an adopt-Kora reversal would reuse the design and swap only the co-sign implementation (recorded then in a new ADR 0014, since 0013 belongs to Phase 2's session model).

## Update 2026-07-12 (settlement lifecycle events, Phase 4)

The Kafka topic catalog gains two settlement-owned lifecycle events, published by the settlement confirmation service (`apps/backend/src/settlement/settlement-confirmation.service.ts`), not the relayer:

- `payment.succeeded` and `payment.failed` are published on provider settlement COMPLETION only, never on submission. For the direct-USDC pilot adapter, completion is USDC confirmation; for the Blockradar adapter (Phase 8), "paid" may mean naira-landed, which is a Phase 6 webhook-semantics decision, so the lifecycle keys off the provider's completion signal rather than the USDC confirmation alone. Both events use the intent id as their Kafka key and their `correlationId`, so one correlation id traces a Payment across services.

These join the Phase 2 events (`payment.created`, `payment.authorized`, `payment.expired`). The topology above is unchanged.
