# 0018: Pay with Xend SDK publishing, licensing, and the fulfillment-hostile result contract

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Pay with Xend planning
**Tags:** sdk, packaging, ci

## Context and Problem Statement

Pay with Xend ships two npm packages a merchant installs into their own site: `@xend/checkout-core` (framework-agnostic button plus result relay, plus a Node webhook verification helper on a separate entry) and `@xend/checkout-react` (a thin React wrapper). Every package in the repo before this phase was `private: true` and nothing had ever been published, so the whole publishing pipeline is net new: registry scope, license, build formats, versioning, release-blocking quality gates, and provenance.

Three decisions also surfaced during planning that were being made implicitly in code and needed a written home: the two packages sit outside ADR 0001's NativeWind styling mandate, the shipped `license` field said `UNLICENSED` while `publishConfig.access` said `public` (a direct contradiction for merchant consumption), and the SDK's result callback is deliberately shaped to make browser-side fulfillment hard. This ADR records all of them so they bind future SDK changes.

## Decision Drivers

- Merchant adoption: the install and legal path must be low friction, because integrators can pick card or Apple Pay instead.
- Supply chain: a payment button is a high-value dependency, so the runtime surface stays zero-dependency and nothing chain-aware or vendor-specific enters either package.
- Security posture: the SDK must make the two most common integration mistakes (fulfilling on the browser callback, losing in-app-webview traffic to a dead popup) structurally hard.
- Existing precedent: the repo already uses the `@xend` npm scope for its private internal packages, Changesets is the natural fit for a workspace, and STACK.md locked the builder (tsdown), the format set, and the size budget.
- Distribution reach: pilot merchants include script-tag-only integrators, so a script-tag build has to exist alongside the npm packages.

## Considered Options

### Registry scope

1. **`@xend` public scope** - reuse the scope already present in the repo, publish the two packages publicly.
2. **Unscoped `xend-checkout` name** - a bare package name with no org.
3. **Private / tarball-only** - keep publishing off npm and hand merchants a tarball.

### License

1. **MIT** - permissive, ubiquitous, near-zero legal review for integrators.
2. **Apache-2.0** - permissive with an explicit patent grant, but heavier and less familiar to small merchants.
3. **Proprietary / `UNLICENSED`** - closed, which is what the packages shipped with by mistake.

## Decision Outcome

**Registry scope: the `@xend` public scope.** The scope is already owned and in use for internal packages, scoped public packages get npm provenance cleanly, and a namespaced install (`@xend/checkout-core`) reads as first-party. Confirming npm org ownership and provisioning the publish token is the human checkpoint that gates the first real publish.

**License: MIT for both packages, with a per-package `LICENSE` file.** Merchant legal friction is an adoption tax, and the SDK contains no protectable secret: all real security lives server-side (the signed webhook and the intent API), so there is nothing to protect by withholding a permissive license. This replaces the erroneous `UNLICENSED` field. `UNLICENSED` alongside `publishConfig.access: public` was self-contradictory for a package meant to be installed by third parties.

**Formats and tooling.** Both packages emit dual ESM and CJS through the `exports` map with type declarations; `@xend/checkout-core` additionally emits a minified IIFE (`dist/xend-checkout.iife.js`, global `window.XendCheckout`) for script-tag merchants. The builder is tsdown (tsup is the documented fallback). Changesets versions and publishes the two packages, with every `private` package (including Phase 5's `@xend/checkout-protocol`) in the Changesets `ignore` list. `publint` and `@arethetypeswrong/cli` run as release-blocking CI checks on both packages. A CI size gate holds the core IIFE under 15 KB gzipped. Publishing uses npm provenance (`id-token: write` in the release workflow plus `publishConfig.provenance: true`).

**ADR 0001 (NativeWind) scope exemption.** `packages/checkout-core` and `packages/checkout-react`, and only these two packages, sit outside ADR 0001's NativeWind styling mandate. `checkout-core` is a zero-dependency web-DOM package that structurally cannot carry NativeWind, so a single scoped `<style>` block injected under a unique `xend-pay-` class prefix is the sanctioned styling approach for the SDK button. This is an exemption for the SDK packages, not a relaxation of ADR 0001 anywhere else.

**The fulfillment-hostile result contract.** The SDK result callback carries the intent reference and a status only (`succeeded | failed | canceled | expired`), with no amount and no verified flag. A popup that closes without a result resolves as `unresolved` (check server-side), never as `failed`. Fulfillment happens exclusively off the signed webhook (ADR 0017) or `GET /payments/:id`, never off the browser object. The client config also has no amount field at all, so an integrator cannot pass an amount through the browser. This shape is the phase's central security decision and binds future SDK changes.

**Isolation rule.** Neither package carries a vendor SDK or chain-aware code. The two consumed cross-phase contracts each live behind exactly one seam file: the postMessage envelope in `adapters/checkout-message.adapter.ts`, typed against `@xend/checkout-protocol/types` (a types-only devDependency, erased at build), and the webhook signing scheme in `webhook/webhook-contract.ts`, citing ADR 0017 and Phase 6's `webhook-signer.ts` as the byte-level oracle.

### Consequences

- Good: a merchant installs with one `npm install` or one `<script>` tag, under a permissive license, with a provenance-attested supply chain.
- Good: the zero-dependency runtime plus the size gate keep the script-tag payload tiny and the transitive-dependency risk at zero.
- Good: the callback shape and the missing amount field make the insecure integration path structurally unavailable.
- Bad: MIT means anyone can fork or rebrand the button; acceptable because the value is the network behind it, not the button code.
- Bad: the redirect fallback and the fulfillment-hostile callback add integration steps a naive merchant might skip; the quickstart mitigates by making the secure path the documented path.

## Pros and Cons of the Options

### `@xend` public scope

- Good: scope already owned and used; provenance works cleanly; reads as first-party.
- Good: keeps the internal and public packages under one namespace.
- Bad: requires confirming npm org ownership before the first publish.

### Unscoped `xend-checkout`

- Good: one character shorter to type.
- Bad: name-squat risk, no org grouping, weaker first-party signal.

### Private / tarball-only

- Good: maximum control over who installs.
- Bad: defeats the distribution thesis; script-tag and npm merchants cannot self-serve.

### MIT

- Good: near-zero legal review for integrators; ubiquitous.
- Bad: no explicit patent grant.

### Apache-2.0

- Good: explicit patent grant.
- Bad: heavier and less familiar for small merchants; more legal review.

### Proprietary / `UNLICENSED`

- Good: nothing.
- Bad: contradicts public consumption; blocks adoption; was shipped by mistake.

## More Information

- Plan: `.claude/plans/pay-with-xend/phases/07-sdk/PLAN.md`
- Consumed contracts: [ADR-0016](./0016-checkout-postmessage-protocol.md) (postMessage envelope), [ADR-0017](./0017-webhook-contract.md) (webhook signing)
- Styling mandate this exempts: [ADR-0001](./0001-consolidate-on-nativewind-styling.md)
- Source: `packages/checkout-core/`, `packages/checkout-react/`, `scripts/check-sdk-size.mjs`, `.github/workflows/sdk-release.yml`, `docs/specs/pay-with-xend-integration-quickstart.md`
