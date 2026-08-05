# 0013: Merchant-scoped Sessions: opaque server-side tokens with rotation and velocity caps

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Planning session (Pay with Xend, Phase 2)
**Tags:** backend, security, pay

## Context and Problem Statement

A returning Consumer should skip the passkey ceremony and confirm a repeat Payment in one tap. That requires the platform to recognize a Consumer at a specific Merchant across visits, which means issuing some credential the Checkout surface can present later. The credential has to be revocable the instant a Consumer asks (revocation must exist in the API from day one, even though its app UI ships later), it must expire on both an absolute and an inactivity clock, and it must never let a recognized Consumer spend beyond conservative per-session limits that sit under the tier caps every Payment already faces.

The obvious reach is a JWT, because the rest of the backend already verifies Privy JWTs. But a Session is not an identity assertion; it is a long-lived spending capability the Consumer must be able to kill. This ADR records the Session token model before the Checkout surface and the mobile revocation UI build on it.

## Decision Drivers

- Revocation must be immediate and total: a revoked Session fails the very next validation, with no window where a still-valid signed token floats around.
- Sessions authorize spending, so they need per-session velocity caps that are provably at or below tier caps, plus an absolute lifetime and a sliding-inactivity window.
- A Session proves recognition, not entitlement: tier limits and live Balance are still evaluated on every Payment and must never be frozen into the Session.
- The raw token is bearer-grade secret material; it must never be stored or logged in a form that a database dump or log leak could replay.
- Owned-interface rule (ADR 0010): hot Session state lives in Redis behind an owned interface, with Postgres as the durable truth.

## Considered Options

1. **Opaque server-side tokens**: a random string; the server stores only its hash and looks the Session up on every use.
2. **JWT plus a revocation list**: a signed token carrying claims, checked against a server-side denylist on every use.
3. **Hybrid: opaque refresh token plus a short-lived derived JWT**: an opaque token mints short JWTs that Checkout presents.

## Decision Outcome

Chosen option: **"Opaque server-side tokens"**, because it gives a single validator and instant revocation as a plain row update, with no signing keys, claim parsing, or algorithm-confusion surface to defend. The other two options reintroduce server-side lookup state anyway (defeating the usual reason to reach for a JWT) while keeping JWT machinery.

Concretely:

- **Opaque random tokens.** A Session token is `xsess_` followed by 32 random bytes, base64url-encoded. It carries no claims. Validation is a lookup, not a signature check.
- **Hash at rest.** Only the SHA-256 of the token is stored, in `sessions.token_hash` (unique). The raw token crosses a boundary exactly once, at issue or rotate, and is never logged or persisted.
- **Absolute plus sliding lifetime.** A Session has a 90-day absolute lifetime and a 30-day sliding-inactivity window. Both values live in config and are tunable without a redeploy. Postgres `expires_at` and `last_used_at` are the durable truth; Redis holds the sliding-activity marker as the hot path and falls back to `last_used_at` on a cache miss.
- **Rotate on use, in place.** Each successful use rotates the token: a fresh random token is minted and its hash overwrites the row's hash. The row identity is stable, so listing and revocation survive rotation, and the prior token stops validating immediately.
- **Velocity caps below tier caps.** Each Session carries per-day payment-count and amount caps. The amount cap must be at or below the smallest tier daily cap; the service refuses to boot otherwise, so the invariant is mechanical, not a review promise.
- **Recognition, not entitlement.** Validating a Session proves who the Consumer is at that Merchant. It does not grant spending authority: every Payment still runs the live capacity check against tier limits and Balance. Tier limits are never copied into the Session row.

### Consequences

- Good: revocation is immediate and total, expressed as a single `revoked_at` write plus a cache clear; the next validation fails from Postgres regardless of Redis state.
- Good: no signing keys, JWKS rotation, or claim-parsing attack surface for the Session credential.
- Good: a leaked database row exposes only a hash, not a usable token; a leaked log exposes neither.
- Good: velocity caps that exceed tier caps cannot be deployed, because they stop the boot.
- Bad: every validation is a database lookup plus a Redis touch, where a JWT could have been verified with no I/O. This is the deliberate cost of instant revocation and is mitigated by the Redis hot path.
- Bad: rotate-on-use means a client that races two requests on the same token can see one fail; the Checkout surface serializes use per Session to avoid this.

## Pros and Cons of the Options

### Opaque server-side tokens

- Good: single validator; revocation is a row update; no claim or algorithm attack surface.
- Good: raw token never stored; only its hash is at rest.
- Bad: a lookup on every use rather than a stateless verification.

### JWT plus a revocation list

- Good: familiar; reuses existing JWT verification.
- Bad: reintroduces server-side state (the denylist) checked on every use, so it is not actually stateless, while keeping the full JWT attack surface (algorithm confusion, key rotation, claim tampering).
- Bad: a Session is a spending capability, not an identity claim; encoding it as a signed assertion invites treating a not-yet-denylisted token as authoritative.

### Hybrid opaque plus short-lived derived JWT

- Good: short JWT lifetimes bound the damage of a leaked derived token.
- Bad: the most machinery of the three (two token types, a minting endpoint, clock-skew handling) for a single-validator system that gains nothing over plain opaque tokens at this scale.

## More Information

- Plan: `.claude/plans/pay-with-xend/PROJECT.md` (Session policy decision) and the Phase 2 plan `.claude/plans/pay-with-xend/phases/02-identity-capability-api/PLAN.md`.
- Source: `apps/backend/src/session/session.service.ts`, `apps/backend/src/session/redis-session-store.ts`, `apps/backend/src/session/session.controller.ts`, and the `sessions` table in `apps/backend/src/db/schema.ts`.
- Related: ADR 0010 (owned-interface rule for the Redis-backed session store) and ADR 0012 (platform topology, `session.issued` and `session.revoked` topics).
