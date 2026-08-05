# 0024: Privy adopted as the consumer-side signing vendor

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Pay with Xend planning
**Tags:** backend, wallet, vendor, pay

## Context and Problem Statement

The consumer side of Pay with Xend needs a vendor to custody passkey credentials and sign Ed25519 (Solana) transactions on behalf of a Consumer. Earlier planning kept an open vendor race (Privy as lead, Turnkey as a documented fallback, a two-item prototype gate on the real domain), with the earlier Squads Grid smart-account work as a separate track. The vendor race is now closed: the founder decision adopts Privy, and the Squads Grid work was ported to Privy rather than dying into another vendor. Production passkeys already live in Privy's credential store (the mobile app enrolls through `@privy-io/expo` with rp.id resolving to the registrable root xend.global).

We need to record that Privy is adopted, that it is reached only through the owned `WALLET_PROVIDER` adapter, and that there is no fallback vendor plan in scope, so later work does not reintroduce a vendor race or import a vendor SDK outside the adapter.

## Decision Drivers

- The vendor race is closed by founder decision; incumbency matters because production passkeys live in Privy's credential store and a switch would strand enrollments.
- The founding migration rule (the silent-discontinuation lesson): no vendor SDK is imported outside its single owned adapter. This rule is review-blocking and applies to Privy too.
- Consumers sign; merchants do not. A Merchant has a canonical internal account referencing an external settlement endpoint and holds no wallet and no signer.
- The adapter seam exists to bound a future vendor switch to one module, not to defer an open choice.

## Considered Options

1. **Privy adopted behind the WALLET_PROVIDER adapter** - one vendor, isolated behind the owned interface, no fallback plan in scope.
2. **Keep an open multi-vendor race** - continue evaluating Privy against Turnkey or Crossmint with a prototype gate.
3. **Import the vendor SDK outside the adapter** - call Privy directly where convenient for less indirection.

## Decision Outcome

Chosen option: **"Privy adopted behind the WALLET_PROVIDER adapter"**, because the race is closed, Grid is ported, and Privy incumbency (enrolled passkeys in its credential store) makes it the low-risk choice, while the owned adapter keeps a future switch bounded to one module.

- Privy is adopted as the consumer-side passkey-credential-custody and Ed25519 signing vendor. It is reached only through the `WALLET_PROVIDER` adapter (`apps/backend/src/wallet/wallet-provider.interface.ts`). No Privy SDK import lives outside that adapter on the backend, and on the checkout surface the Privy web SDK is confined to a single code-split ceremony module.
- Privy is consumer-side only. Merchants have no Privy wallet; a Merchant has a canonical internal account referencing an external settlement endpoint (see ADR 0015).
- The adapter seam bounds a future vendor switch to one module. That is its purpose, not to defer an open choice. There is no Turnkey or Crossmint fallback plan and no re-enrollment contingency in scope. The Turnkey and Crossmint names that remain in the adapter interface comments are illustrative future-adapter references, not an active plan.

### Consequences

- Good: the vendor decision is settled, so downstream phases build against one signing vendor without a prototype gate or a fallback branch.
- Good: the owned adapter keeps the migration rule intact; a future switch rebuilds one module by design.
- Good: incumbency avoids stranding the passkeys already enrolled in Privy's credential store.
- Bad: a single vendor is now load-bearing for consumer signing. The adapter bounds the blast radius, but a Privy outage or discontinuation is a real risk that the seam mitigates rather than removes.
- Bad: dropping the documented fallback means a future switch is unplanned work, not a pre-built path. The seam makes it tractable, not free.

## Pros and Cons of the Options

### Privy adopted behind the WALLET_PROVIDER adapter

- Good: settles the vendor decision and keeps the migration rule intact.
- Good: incumbency avoids re-enrollment; the seam bounds a future switch.
- Bad: one vendor is load-bearing for consumer signing.

### Keep an open multi-vendor race

- Good: hedges against a single-vendor risk.
- Bad: the race is closed and Grid is ported; reopening it is churn against a made decision and delays the phases that depend on a settled vendor.

### Import the vendor SDK outside the adapter

- Good: less indirection in the short term.
- Bad: review-blocking. It violates the founding migration rule and turns a bounded future switch into a repo-wide rewrite.

## More Information

- Plan: `.claude/plans/pay-with-xend/phases/05-checkout-surface/PLAN.md`
- Related: [ADR-0010](./0010-no-load-bearing-provider.md) (owned interfaces per provider category), [ADR-0015](./0015-settlement-provider-layer.md) (settlement vendors behind their own seam; merchants have no wallet)
- Source: `apps/backend/src/wallet/wallet-provider.interface.ts`, `apps/mobile/hooks/usePasskey.ts`, `apps/checkout/src/ceremony/passkey.ts`
