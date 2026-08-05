# 0016: Checkout result transport: versioned postMessage protocol and surface security posture

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Pay with Xend planning
**Tags:** frontend, checkout, security, pay

## Context and Problem Statement

The hosted checkout surface at pay.xend.global runs a Payment inside a popup (or a redirect) opened by a merchant page on a different origin. When the Payment reaches a terminal state the merchant page needs to hear about it so it can update its own UI. The browser transport for that signal is `window.postMessage` in popup mode and a navigation to a return URL in redirect mode. Both are attacker-reachable surfaces: a hostile page can post a forged message to a merchant listener, a hostile origin can try to receive a result meant for someone else, and a naive listener that trusts `event.data` will believe whatever it is handed.

Two separate consumers must agree on the exact shape of this signal: the checkout surface (the sender, this phase) and the merchant SDK (the listener, Phase 7). The SDK is deliberately zero-dependency with a tight byte budget, so it cannot import a shared runtime schema. We need one canonical, versioned envelope, a validation guard that is safe by construction, and a written record of the header posture the static host serves, so neither consumer drifts and neither becomes the trust anchor for money.

## Decision Drivers

- The browser result is a UX convenience, not the settlement signal. The merchant's truth is the signed webhook, so the envelope must be fulfillment-hostile: it carries no amount and no verified flag, only a reference and a status.
- The transport must be forgery-resistant: exact-origin matching in both directions, a nonce and reference that tie a result to the popup that was opened, and rejection of the sandbox `null` origin.
- Two independent implementations (surface and SDK) must not drift. The SDK cannot take a runtime dependency on the protocol package, so the contract has to be enforceable at compile time and by a reconciliation pass.
- The envelope must be able to evolve without breaking old listeners, so it carries a version and consumers ignore versions they do not know.
- The static host that serves pay.xend.global needs a header posture that preserves the popup channel while locking out framing and clickjacking. This posture belongs to the checkout host, which is a different origin from the backend API.

## Considered Options

1. **Versioned exact-origin envelope in a shared package, hand-mirrored by the SDK** - a `v`-stamped envelope validated by an exact-origin guard, frozen in `@xend/checkout-protocol`, with the SDK hand-mirroring it and reconciling field-for-field plus importing the types-only path as a devDependency.
2. **Unversioned ad-hoc messages** - post whatever fields are convenient and read them loosely on the other side.
3. **postMessage as the source of truth** - treat a `succeeded` message as proof the Payment settled.
4. **Runtime-shared protocol package inside the SDK** - have the SDK import the schema (and zod) at runtime.

## Decision Outcome

Chosen option: **"Versioned exact-origin envelope in a shared package, hand-mirrored by the SDK"**, because it makes the transport safe by construction, keeps the settlement truth on the webhook, and enforces cross-consumer agreement at compile time without dragging a runtime dependency into the SDK's byte budget.

The envelope:

- A versioned envelope with a `v` field and the forward-compat rule: consumers ignore versions they do not recognize. v1 is `{ xend: 'checkout', v: 1, nonce, reference, type, status }`.
- Canonical field vocabulary: the wire id is `reference` (never intentRef); statuses are `succeeded | failed | canceled | expired` (single-l, Stripe-style).
- Every message carries a status. A cancel message carries `status: 'canceled'` so a status-only consumer needs no per-type special case.
- No Ready or handshake message ships in v1. It would be contract over-provision with no v1 consumer. If a handshake is needed later it arrives as a new message type under the same version rules.
- No money value lives in the envelope. The result is reference plus status only; the webhook is the truth.

Security:

- Exact-origin allowlist in both directions. No wildcard target origin, no `includes`, `startsWith`, or regex origin check. A literal `null` origin (sandboxed frame) is always rejected.
- Nonce and reference correlation so a result matches the popup that was actually opened. The single guard `parseCheckoutMessage` is used by both the SDK (listening for the checkout origin) and the surface (validating an opener handshake).
- Redirect-completion carries the same status via the backend-signed return URL, so postMessage and redirect are UX-equivalent and neither is the settlement signal.

The popup launch handshake (paired SDK contract): the SDK opens the popup synchronously in the click handler with only `?nonce` and `?mode`, before the intent exists, then navigates the popup to append `intent=<reference>` once creation resolves. The surface treats an intent-less first load as the normal handshake state and renders a loading shell, never an error. A missing nonce stays a hard error.

Consumption model: `@xend/checkout-protocol` is the canonical contract. The zero-dependency merchant SDK hand-mirrors the envelope, must reconcile field-for-field against `envelope.ts` in review, and imports `@xend/checkout-protocol/types` as a devDependency. Types erase at build, so zod never enters the SDK runtime, and re-drift fails compilation. The `satisfies z.ZodType<CheckoutEnvelope>` clause in `envelope.ts` ties the runtime schema to the types-only file so the two cannot silently disagree.

Surface security-header posture (this ADR governs the pay.xend.global static host): the host serves `Cross-Origin-Opener-Policy: same-origin-allow-popups` (never `same-origin`, which would sever `window.opener` and kill the popup channel), `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. Ownership note: ADR 0012 governs the backend API origin's CORS and COOP policy; this ADR governs the checkout static host. The two are different origins and must not be conflated.

### Consequences

- Good: the transport is forgery-resistant by construction, and a compromised browser result cannot move money because the webhook is the truth.
- Good: the SDK stays zero-dependency and within budget while still being pinned to the canonical contract by compile-time types and a reconciliation pass.
- Good: the envelope can evolve behind the version rule without breaking existing listeners.
- Good: the header posture preserves the popup channel while closing framing and clickjacking vectors.
- Bad: the hand-mirror plus reconciliation is process, not a runtime import, so a careless reviewer could let a mirror drift. The types-only devDependency and the reconciliation checklist exist to catch that, but they depend on the review being run.
- Bad: keeping the envelope fulfillment-hostile means the merchant page cannot render a trustworthy amount from the message alone and must rely on its own record or the webhook.

## Pros and Cons of the Options

### Versioned exact-origin envelope in a shared package, hand-mirrored by the SDK

- Good: safe by construction (exact origin, nonce, reference, null rejection) and evolvable via the version rule.
- Good: enforces cross-consumer agreement at compile time without a runtime dependency in the SDK.
- Bad: relies on a reconciliation pass to keep the hand-mirror honest.

### Unversioned ad-hoc messages

- Good: least code today.
- Bad: unfixable later. With no version and no canonical shape, every consumer drifts and there is no safe way to evolve the contract.

### postMessage as the source of truth

- Good: simplest merchant integration if it could be trusted.
- Bad: the browser result is attacker-controllable. Treating it as settlement truth is a direct path to fraudulent fulfillment.

### Runtime-shared protocol package in the SDK

- Good: no hand-mirror to reconcile.
- Bad: drags zod and the schema into the SDK runtime, breaking the zero-dependency byte budget. The spec-mirror plus types-only devDependency plus reconciliation achieves the same safety without the runtime cost.

## More Information

- Plan: `.claude/plans/pay-with-xend/phases/05-checkout-surface/PLAN.md`
- Frozen contract: `.claude/plans/pay-with-xend/CONTRACTS.md` (checkout postMessage envelope)
- Related: [ADR-0010](./0010-no-load-bearing-provider.md) (owned interfaces per provider category), [ADR-0012](./0012-pay-platform-topology.md) (backend origin topology and CORS/COOP ownership), [ADR-0021](./0021-web-styling.md) (web styling for the surface)
- Source: `packages/checkout-protocol/src/envelope.ts`, `packages/checkout-protocol/src/types.ts`, `apps/checkout/public/_headers`
