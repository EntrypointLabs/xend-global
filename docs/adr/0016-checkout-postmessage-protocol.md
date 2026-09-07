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

Surface security-header posture (this ADR governs the pay.xend.global static host): the host serves `Cross-Origin-Opener-Policy: same-origin-allow-popups` (never `same-origin`, which would sever `window.opener` and kill the popup channel), `Content-Security-Policy: frame-ancestors 'none'` (superseded, see the 2026-09-07 update), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. Ownership note: ADR 0012 governs the backend API origin's CORS and COOP policy; this ADR governs the checkout static host. The two are different origins and must not be conflated.

### Consequences

- Good: the transport is forgery-resistant by construction, and a compromised browser result cannot move money because the webhook is the truth.
- Good: the SDK stays zero-dependency and within budget while still being pinned to the canonical contract by compile-time types and a reconciliation pass.
- Good: the envelope can evolve behind the version rule without breaking existing listeners.
- Good: the header posture preserves the popup channel while closing framing and clickjacking vectors.
- Bad: the hand-mirror plus reconciliation is process, not a runtime import, so a careless reviewer could let a mirror drift. The types-only devDependency and the reconciliation checklist exist to catch that, but they depend on the review being run.
- Bad: keeping the envelope fulfillment-hostile means the merchant page cannot render a trustworthy amount from the message alone and must rely on its own record or the webhook.

## Update 2026-09-07: the surface is framable by a registered merchant origin

This supersedes the framing half of the header posture recorded above. It does
not change the envelope, the origin matching, the nonce and reference
correlation, or the rule that the webhook is the settlement truth.

Running the ceremony in a popup works everywhere, but a second window appears,
and that is the one place the flow stops feeling like Apple Pay. A cross-origin
frame can run `navigator.credentials.get()` only when the embedding frame
carries `allow="publickey-credentials-get"`, which the SDK can set because the
SDK creates the frame. So the ceremony now runs inline in the sheet, and the
popup becomes the fallback.

What changes:

- **`frame-ancestors` names the merchant instead of nobody.** The surface is
  served with `frame-ancestors` listing the Merchant's registered origins,
  where it previously said `'none'`. The header is set per merchant at the
  edge from the server-validated `merchantOrigin`, resolved against the
  Merchant's allowlist. It is **never** built from a query parameter: a
  request-controlled `frame-ancestors` is an attacker-controlled
  `frame-ancestors`.
- **`X-Frame-Options` is dropped on those responses only.** It has no
  allowlist form, so `DENY` would veto the CSP and `ALLOW-FROM` is dead in
  every current browser. Responses that are not framed by a registered origin
  keep it.
- **The popup channel and its COOP posture are unchanged.**
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` stays, and the popup
  remains a fully supported presentation and the automatic fallback. The SDK
  falls back to it when the environment is an in-app browser, when the frame
  errors, when a settled frame is still readable from the merchant page (which
  means it never left about:blank, which is what a surviving `frame-ancestors
'none'` looks like from the outside), and as a backstop when the frame has
  not loaded at all inside a short timeout. The fallback carries the same nonce
  and reference, so nothing about the correlation is weakened by taking it.
- **`mode=iframe` joins `popup` and `redirect`.** The frame is navigated to
  the same launch URL the popup gets, with `mode=iframe`. Results still arrive
  as the v1 envelope, validated by the same guard, from the same exact origin.
- **v1 gains a handshake: `xend.checkout.ready`.** The original decision above
  declined to ship one on the grounds that it had no v1 consumer, and said that
  if a handshake were ever needed it would arrive as a new message type under
  the same version rules. That is what this is. The surface posts it the moment
  it mounts, including on the intent-less first load, through the same
  `merchantWindow()` and the same exact target-origin discipline as every other
  message. It is its own shape rather than a status-bearing envelope, because
  at handshake time there is honestly no reference and no status to report:
  `{ xend, v, nonce, type }` and nothing more. `parseCheckoutMessage` returns
  it as itself, so reading a status off a handshake is a compile error rather
  than an undefined.
  Its one exception: it is the only message whose target origin is the one the
  launch URL named rather than the one the server stored, because it is sent
  before the intent that carries the verified origin exists. That is bounded by
  what it says, which is a nonce the receiver itself generated. Every terminal
  message still goes only to the server-verified merchant origin.

What this gives up:

- **Clickjacking is back on the table.** `frame-ancestors 'none'` was an
  absolute answer, and an allowlist is not. A registered origin that is itself
  compromised, or a merchant that registers an origin they do not fully
  control, can now frame the ceremony. The bound on that is the allowlist plus
  the sheet's existing arming delay, which enables the confirm control only
  after a delay and a genuine interaction, so a transparent overlay cannot be
  tapped through. That is mitigation, not elimination.
- **The blast radius of a bad allowlist entry grew.** An origin on the list was
  previously trusted to receive a reference and a status. It is now also
  trusted to host the ceremony. Allowlist entry is the security boundary for
  the whole feature, so allowlist writes deserve the scrutiny of a
  security-relevant change.
- **One more thing can quietly stop working.** The inline path depends on the
  edge computing the right header per merchant. Get it wrong and nothing
  breaks visibly: every shopper silently takes the popup fallback, and the
  Apple Pay feel is gone with no error anywhere. This needs monitoring on the
  fallback rate, not just on failures.

The SDK keeps three liveness signals rather than one: the handshake, which is
proof; an `about:blank` readability probe on the settled frame, which infers the
same thing from the browser and covers a surface deployed before the handshake
existed; and a timer, for a frame that never settles at all. The timer stays
short, three seconds, because the fallback `window.open` runs from it and has
to remain inside the browser's transient activation window.

What is gained: on a correctly registered merchant, the whole payment happens
in one window, on one page, with the passkey still on Xend's origin and the
merchant still unable to see or influence the ceremony.

Source: `packages/checkout-core/src/{index,modal,message-listener,popup}.ts`.

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
