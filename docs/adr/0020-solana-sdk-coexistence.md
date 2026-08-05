# 0020: Two Solana toolchains: @solana/kit for new money-moving code, web3.js retained for existing modules

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Pay with Xend planning
**Tags:** backend, solana, tooling

## Context and Problem Statement

The existing backend (transfer, activity, and the SOLANA_RPC adapters) is built on `@solana/web3.js` 1.x. The new Pay money-moving code (the settlement module and the fee-payer relayer deployable) needs to build, pin, and co-sign transactions with the modern `@solana/kit` 7 plus `@solana-program/*` packages, which are tree-shakeable, typed around opaque `Address`/`bigint` values, and the direction the ecosystem is moving. Rewriting every existing call site to kit at the same time as building the settlement leg would be a large, risky, all-at-once migration with no product value. We need a policy for how the two toolchains coexist.

## Decision Drivers

- The settlement leg and relayer are new money-moving code where kit's safety and instruction builders pay for themselves immediately.
- The existing transfer/activity code is stable and in maintenance mode; a big-bang migration is pure risk with no product value.
- The ADR 0010 SOLANA_RPC seam is SDK-neutral (base64 wire transactions, plain strings and bigints), so both toolchains can share one seam.
- Settlement-endpoint provisioning needs a rent-exemption read, which must go through the owned seam rather than a raw kit RPC client (the ADR 0010 rule).

## Considered Options

1. **kit-for-new, web3.js-retained** - new money-moving code on kit; existing modules stay on web3.js; both share the SDK-neutral SOLANA_RPC seam.
2. **Uniform web3.js** - build the settlement leg on web3.js too, one toolchain everywhere.
3. **Big-bang kit migration** - migrate transfer/activity/adapters to kit now.

## Decision Outcome

Chosen option: **"kit-for-new, web3.js-retained"**, because it gets kit's safety on the code that moves money without a risky rewrite of stable modules, and the SDK-neutral seam lets both sides coexist cleanly.

Specifics:

- New money-moving Pay code (the settlement module here and the fee-payer relayer deployable) builds on `@solana/kit` 7 and `@solana-program/*` (token, system, compute-budget). Existing modules (transfer, activity) and the SOLANA_RPC adapters stay on `@solana/web3.js` 1.x, which is stable and in maintenance mode. `@solana/web3.js` is retained, not removed.
- The ADR 0010 SOLANA_RPC adapters stay web3.js-based behind an SDK-neutral interface (base64 wire transactions, plain strings and bigints). This lets both toolchains share one seam, and it is why the settlement code reads the chain only through SOLANA_RPC, never a raw kit RPC client.
- Rent-exemption resolution: the SOLANA_RPC seam is extended with `getMinimumBalanceForRentExemption(space)` (implemented in both adapters via the existing web3.js `Connection`) rather than the settlement code calling a raw kit RPC. Provisioning consumes the extended seam.
- Migration trigger for existing call sites: the next substantive rework of transfer/activity code, a web3.js 1.x security advisory, or its formal end-of-life, whichever comes first. There is no scheduled big-bang migration.
- Explicit non-decision: no `@solana/compat` bridge is introduced, because the two sides share no runtime objects (each builds and serializes its own transactions to base64; the seam trades bytes, not SDK objects).

### Consequences

- Good: kit's instruction builders and typed values protect the code that moves money, with no rewrite of stable modules.
- Good: one SDK-neutral seam serves both toolchains; the settlement code stays inside the owned seam for chain reads.
- Bad: two Solana toolchains live in the repo at once, a larger dependency surface and two mental models for contributors until the eventual migration.
- Bad: a shared helper that needs an SDK object cannot be trivially reused across the two sides; anything shared crosses the base64 seam.

## Pros and Cons of the Options

### kit-for-new, web3.js-retained

- Good: kit safety on money-moving code, no risky rewrite.
- Good: SDK-neutral seam shared by both.
- Bad: two toolchains coexist for a time.

### Uniform web3.js

- Good: one toolchain, smallest dependency surface.
- Bad: forgoes kit's typed instruction builders on exactly the code where they matter most (money movement).

### Big-bang kit migration

- Good: single toolchain, modern everywhere.
- Bad: large, risky rewrite of stable modules with no product value; blocks the settlement leg on unrelated churn.

## More Information

- Plan: `.claude/plans/pay-with-xend/phases/04-settlement-leg/PLAN.md`
- Related: [ADR-0010](./0010-no-load-bearing-provider.md) (owned SOLANA_RPC seam), [ADR-0015](./0015-settlement-provider-layer.md) (settlement provider layer)
- Source: `apps/backend/src/solana/solana-rpc.interface.ts` (SDK-neutral seam, extended with `getMinimumBalanceForRentExemption`), `apps/backend/src/settlement/` (kit money-moving code)
