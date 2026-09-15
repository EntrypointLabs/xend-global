# 0032: Every Account is provisioned with a US $100 daily one-signature ceiling

**Status:** Accepted
**Date:** 2026-09-07
**Accepted:** 2026-08-14
**Deciders:** Xend founding team
**Tags:** backend, wallet, security, compliance

## Context and Problem Statement

[0025](0025-account-multisig-signer-set.md) put everyday **Spends** on a
`SpendingLimit` policy that S1 alone can execute, and above it a policy that needs
S1 and S2. The limit is therefore the size of the residual exposure to a Privy
compromise or signing bug: up to the limit, Turnkey is never asked. The decisions
spec resolved the band as `O3` after comparing what custodial exchanges, Braavos and
the Central Bank of Nigeria's tiered-authentication ladder require, and arrived at
two figures: US $100 per transaction with $300 cumulative from the exchange norm,
and NGN 200,000 per rolling 24 hours from CBN's OTP-grade tier.

The policy lives on chain, denominated in USDC, and is installed at provisioning
before a **Consumer** has told us anything about where they live. A number has to be
chosen for everyone, and it has to be a constant.

## Decision Drivers

- Nothing on an **Account** records which regime a **Consumer** falls under, so the
  same terms apply to everyone.
- Erring high puts a Nigerian **Consumer** over a regulatory ceiling on a single
  signature. That is the one failure here that is not merely inconvenient, so the
  lower of the two figures wins.
- An on-chain constant cannot track a floating exchange rate. The dollar figure
  has to stay under the naira ceiling across the plausible band, not at today's
  rate.
- CBN's ladder caps the day, not the transaction. A second, finer per-use limit
  would be one no regulation asks for.
- Changing the terms on an existing **Account** is a settings change: two
  signatures and the 24 hour lock. The default is therefore the number most
  **Accounts** will carry for their whole life.

## Considered Options

1. **US $100 per day, per-use equal to per-period, any destination** - the lower of
   the two `O3` figures, fixed.
2. **The exchange norm, $100 per transaction and $300 per day** - higher daily
   ceiling, extra per-use limit.
3. **Per-Consumer terms from a jurisdiction field** - record the regime at sign-up
   and provision a different limit per regime.

## Decision Outcome

Chosen option: **"US $100 per day, per-use equal to per-period, any
destination"**, because it is the only figure that is safe under both regimes for
every **Consumer** without recording anything about them.

`buildDefaultSpendingLimit` (`apps/backend/src/account/spending-limit.terms.ts`)
returns `SpendingLimitTerms` with `DAILY_CEILING_USD = 100n` scaled to USDC's six
decimals as both `maxPerUse` and `maxPerPeriod`, `period: 'Daily'`, and an empty
`destinations` list. The mint is the active USDC mint from
`EXPO_PUBLIC_USDC_MINT_ADDRESS`.

### Why $100

$100 holds under NGN 200,000 down to NGN 2,000 per dollar, well past the current
rate. If the naira moves past that, the constant is wrong in the unsafe direction
and has to come down; that is the one condition under which this number changes on
its own. The comment on the constant carries the same reasoning so the next
reader does not have to find this ADR to know why.

### Why per-use equals per-period

A **Consumer** may spend the whole day's allowance at once. CBN caps the day; setting
`maxPerUse` lower would add a finer limit no regulation asks for and would turn a
single ordinary purchase into a two-signature event.

### Why any destination

The limit is about value per day, not about who is paid. An allowlist on the
policy would break ordinary sends to new recipients. The new-recipient step-up
recorded in the decisions spec is a product-layer decision, not a policy term.

### Where the terms are consumed

Provisioning installs them
([0033](0033-provisioning-idempotency-and-prepared-transaction-pins.md)). A primary
rotation restates them in its `PolicyUpdate`
([0031](0031-lost-passkey-primary-rotation.md)), because a policy update replaces
the whole policy. `resolveSpendRoute` in `packages/smart-account/src/spend.ts` reads
the live policy to decide whether a **Spend** takes one signature or two, and
`apps/backend/scripts/read-spending-limit.ts` reads it for an operator.

### Consequences

- ✅ **Good:** Safe under both regimes for every **Consumer**, with nothing recorded
  about them.
- ✅ **Good:** One tap for everyday spends, and the residual single-vendor exposure
  is bounded at $100 a day per **Account**.
- ✅ **Good:** The reasoning travels with the constant.
- ⚠️ **Bad:** A **Consumer** outside Nigeria is held to a Nigerian ceiling. A $150
  purchase in the US takes the phone.
- ⚠️ **Bad:** The terms are not editable from the app. `settings/spending-limits.tsx`
  is an explainer with an info sheet and no API call. The master context's claim
  that limits are "editable or removable at any time" was corrected on
  2026-09-07. Editing is a settings change under the lock and is not built.
- ⚠️ **Bad:** Two places restate the terms (provisioning and the primary rotation).
  When editing lands, the rotation has to read the live terms or it silently
  resets a **Consumer**'s chosen limit.
- ⚠️ **Bad:** The constant is pegged to an exchange-rate assumption and nothing
  monitors it.

## Pros and Cons of the Options

### US $100 per day, fixed

- ✅ Lower of the two figures; safe everywhere.
- ✅ No jurisdiction data collected or stored.
- ❌ Conservative for non-Nigerian **Consumers**.

### The exchange norm, $100 per transaction and $300 per day

- ✅ Closer to what a US **Consumer** expects.
- ❌ $300 exceeds NGN 200,000 at any plausible rate, so it is over the CBN tier.
- ❌ Adds a per-use limit no regulation asks for.

### Per-Consumer terms from a jurisdiction field

- ✅ Right number for each regime.
- ❌ Requires collecting and trusting a jurisdiction claim before provisioning,
  which nothing else in sign-up needs.
- ❌ A wrong claim is a regulatory breach on a single signature.

## More Information

- `O3` in [`docs/specs/account-security-model-decisions.md`](../specs/account-security-model-decisions.md)
  ("O3 resolved: the spending limit band") for the comparison that produced the
  two figures.
- Related: [0025](0025-account-multisig-signer-set.md) (the policy this fills in),
  [0033](0033-provisioning-idempotency-and-prepared-transaction-pins.md),
  [0031](0031-lost-passkey-primary-rotation.md).
- Source: `apps/backend/src/account/spending-limit.terms.ts`,
  `packages/smart-account/src/spend.ts` (`resolveSpendRoute`),
  `packages/smart-account/src/policy.ts` (`SpendingLimitTerms`),
  `apps/backend/scripts/read-spending-limit.ts`,
  `apps/mobile/app/(tabs)/settings/spending-limits.tsx`
