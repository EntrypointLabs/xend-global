# 0017: Outbound merchant webhook contract: HMAC t/v1 signing, event schema, and delivery semantics

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Pay with Xend
**Tags:** backend, security, pay

## Context and Problem Statement

Merchants need a trustworthy settlement-truth signal. The webhook signing scheme, the event schema, the SSRF posture, and the retry contract are shared contracts that Phase 7's `verifyWebhook` helper and Phase 8's console consume, so they cannot change later without breaking integrators. They are pinned here. Webhooks must fire only from confirmed settlement, never from submission, and delivery must be safe under at-least-once, unordered transport.

## Decision Drivers

- REQ-WEBHOOK-TRUTH: fire only from consumed confirmation/expiry events.
- REQ-IDEMPOTENCY: a deterministic, stable event id so a replay is a non-event for the merchant.
- Familiarity: the pilot merchant's ecosystem and SDK snippets already understand Stripe's scheme.
- Security: SSRF guard (HTTPS only, no private ranges, no redirects); no single global secret; zero-downtime secret rotation.

## Considered Options

1. **Symmetric HMAC t/v1, Stripe-style** — `Xend-Signature: t=<unix>,v1=<hex>`, signed content `t.rawBody`.
2. **Standard Webhooks spec** — three headers (webhook-id / webhook-timestamp / webhook-signature), signs `id.timestamp.body`, base64 `v1,` signature form.
3. **Asymmetric / JWS signatures** — publisher signs with a private key, merchant verifies a public key.
4. **mTLS only** — client-cert transport authentication.

## Decision Outcome

Chosen option: **"Symmetric HMAC t/v1, Stripe-style"**, because it is the scheme the pilot merchant's ecosystem and our SDK helper already understand, it verifies with a few lines of standard-library code, and per-endpoint secrets with dual-secret rotation cover the operational needs.

The frozen contract:

- **Signing.** HMAC-SHA256 over the exact bytes `${timestamp}.${rawBody}` with header `Xend-Signature: t=<unix>,v1=<hex>`, hex-encoded, using the full `whsec_` secret as the UTF-8 key. A 5-minute replay tolerance. Per-endpoint `whsec_` secrets, with two concurrently valid secrets (one `v1=` per secret) for zero-downtime rotation. Sign the exact stored bytes, never parsed-then-reserialized JSON.
- **Not Standard Webhooks.** The scheme is Stripe-style t/v1 and is NOT the Standard Webhooks specification, despite the `whsec_` secret prefix. Standard Webhooks uses three headers, signs `id.timestamp.body`, and base64-encodes with a `v1,` comma form; adopting its prefix convention without its scheme is a deliberate familiarity choice. Any future migration is a new signature scheme version (e.g. v2).
- **Event object.** `{ id: evt_<hash>, object: 'event', type, created, livemode, correlation_id, data: { object } }`. The id is deterministic (`evt_` + sha256(`topic:intentId`) prefix), stable across retries and redeliveries. Merchants dedup on the signed body `id`, NOT on the `Xend-Event-Id` transport header (which is unsigned convenience). The full object is delivered per event: at-least-once and unordered, the object is the truth, and merchants reject events older than their stored state.
- **Convert-at-settlement paid semantics** (additive to the frozen signing scheme, HANDOFF v3): `payment.succeeded` means settlement CONFIRMED. For a direct-USDC Merchant that is USDC-confirmed-at-the-endpoint; for a naira Merchant it is the settlement provider's settlement-complete signal (Phase 4 leaves the seam, Phase 8 implements the Blockradar signal). The payload's `data.object.settlement` block carries that provider completion, not just the USDC tx. The t/v1 HMAC signing, header, replay window, and dedup-on-signed-id are unchanged by this.
- **Firing rule.** Webhooks fire ONLY from consumed Kafka confirmation/expiry events (payment.succeeded/failed from Phase 4, payment.expired from Phase 2), never from submission or the merchant API. The new `EVENT_CONSUMER` seam mirrors `EVENT_PUBLISHER`; see ADR 0012 for the eventing lineage (topics, key = intent id, correlation header).
- **Delivery.** Exponential backoff with jitter capped near 3 days, then exhausted with an ops alert; every attempt logged in `webhook_deliveries`. SSRF guard (HTTPS only, private/loopback/link-local rejected at resolve time, no redirect following), re-run at delivery time. Test/live separation via per-intent and per-endpoint mode plus a `livemode` flag. Automatic materialization is idempotent under a partial unique index; manual redelivery reuses the same event id and is exempt.

### Consequences

- ✅ **Good:** Integrators verify with standard-library HMAC; the SDK helper is a few lines.
- ✅ **Good:** Deterministic ids + at-least-once make replays and redeliveries safe.
- ✅ **Good:** Dual-secret rotation is zero-downtime; SSRF guard closes the outbound-request attack surface.
- ⚠️ **Bad:** Diverging from Standard Webhooks means a future migration to it is a new signature version.
- ⚠️ **Bad:** Symmetric secrets must be handled carefully on both sides (mitigated by per-endpoint scoping + rotation).

## Pros and Cons of the Options

### Symmetric HMAC t/v1, Stripe-style

- ✅ Familiar to the pilot merchant and the SDK ecosystem.
- ✅ Trivial verification, standard library only.
- ✅ Dual-secret rotation is a non-event.
- ❌ Not the emerging Standard Webhooks interop spec.

### Standard Webhooks spec

- ✅ An emerging cross-vendor interop standard.
- ❌ Adds a three-header contract and base64/`v1,` format for no pilot gain.
- ❌ Its `whsec_` prefix without its scheme would confuse; the pilot ecosystem expects Stripe's shape.

### Asymmetric / JWS signatures

- ✅ No shared secret on the merchant side.
- ❌ Heavier merchant verification, no pilot need.

### mTLS only

- ✅ Strong transport authentication.
- ❌ Pilot merchants cannot readily provision client certs.

## More Information

- ADR 0012 (pay platform topology / eventing lineage) for EVENT_CONSUMER's topics and correlation header.
- CONTRACTS.md: the frozen t/v1 signing contract and the additive `data.object.settlement` block.
- Source: `apps/backend/src/webhook/webhook-signer.ts`, `apps/backend/src/webhook/webhook-events.ts`, `apps/backend/src/webhook/webhook-delivery.service.ts`, `apps/backend/src/webhook/webhook-dispatcher.service.ts`, `apps/backend/src/events/event-consumer.interface.ts`.
