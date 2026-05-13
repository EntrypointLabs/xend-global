# 0009: Visual-regression check: manual iOS + Android screenshots, no automated harness (this PR)

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Engineering team
**Tags:** mobile, quality, visual-regression

## Context and Problem Statement

The style-cleanup refactor ([ADR-0001](./0001-consolidate-on-nativewind-styling.md)) has **"no visual regression"** as its core success criterion. The refactor touches ~80 files across `apps/mobile/`, including:

- Reanimated-bearing modals where the className+style cascade is fragile.
- Pressables in navigation context where dynamic className causes runtime crashes.
- Components with Android shadow / elevation drift relative to iOS.
- Inter font weight fallback behaviour that differs between iOS and Android.

We need to **prove** the refactor produces pixel-equivalent output. Options range from a fully automated visual-regression harness to spot-check screenshots.

PROJECT.md anti-features explicitly exclude adding test infrastructure in this refactor. The mobile app currently has zero tests; introducing a visual regression harness would be a significant standalone initiative.

## Decision Drivers

- Prove pixel-equivalence on the highest-risk surfaces.
- Don't introduce test infrastructure as part of this refactor (PROJECT.md anti-feature).
- Cover the iOS + Android parity hazards (Android shadow drift, Inter font fallback).
- Cover both light and dark mode.
- Land before merge — not "we'll check later."

## Considered Options

1. **Manual before/after screenshots — iOS + Android × light + dark × 9 key screens (36 image pairs).** Reviewer captures pairs on simulators or physical devices; embeds them in the PR description.
2. **Manual screenshots — iOS only, both modes (18 image pairs).** Half the cost; assumes Android renders identically (risk: shadow + font issues land silently).
3. **Spot check — iOS + Android for the 3 highest-risk screens, iOS-only for the rest.** Pragmatic middle ground.
4. **Bootstrap a visual-regression harness (e.g. `react-native-owl`, `jest-image-snapshot`).** Automated; reusable. Significant setup cost; introduces a test framework.
5. **No visual check; rely on type-check and lint.** Cheapest; provides no protection against actual rendering regressions.

## Decision Outcome

Chosen option: **"Manual screenshots — iOS + Android × light + dark × 9 key screens (36 image pairs)"**, because:

- Android-specific pitfalls (`shadow-*` utilities, Inter font fallback) are documented research findings — skipping Android leaves the largest regression vector unverified.
- Both modes are required because `darkMode: "class"` is a structural change ([ADR-0002](./0002-darkmode-class-strategy.md)); light-mode parity does not imply dark-mode parity.
- 9 screens cover the major flows (auth, send, settings, modals) without becoming a 50-screen sweep.
- Manual is acceptable here because this is a one-time refactor verification, not ongoing CI coverage. Automated harness is the right shape for ongoing protection, but is a separate initiative.

The 9 key screens (matching `PROJECT.md`):

1. `auth-start` (forced dark canvas)
2. `auth-login`
3. `auth-otp-entry`
4. `tabs/index` (home)
5. `tabs/settings`
6. `send/amount`
7. `send/confirm`
8. `modals/kyc`
9. `modals/bankdetails`

Captures live under `phases/06-enforcement-and-verification/visual-diff/` (or linked from the PR description if the artefacts are too large to commit).

### Consequences

- ✅ Highest-risk regression vectors are covered.
- ✅ Both platforms verified; Android-specific issues caught.
- ✅ Both modes verified; class-strategy dark mode validated.
- ✅ No new test infrastructure — keeps refactor scope clean.
- ⚠️ 36 image pairs is a non-trivial reviewer effort (~1-2 hours).
- ⚠️ Manual = not repeated automatically on future refactors. The next refactor must repeat this work or invest in the deferred automated harness.
- ⚠️ Pixel-equivalence is judged by human eye; subtle drift (e.g. 1px line-height shift) may slip through.

## Pros and Cons of the Options

### Manual iOS + Android × light + dark × 9 screens

- ✅ Best regression coverage for the cost.
- ❌ Reviewer time investment.

### Manual iOS only

- ✅ Half the cost.
- ❌ Android shadow + Inter font issues likely land silently.

### Spot-check hybrid

- ✅ Cost-effective.
- ❌ Decision about which screens to spot-check is itself a regression vector.

### Automated harness

- ✅ Reusable; runs in CI.
- ❌ Significant setup; introduces test infra (anti-feature for this refactor).

### No visual check

- ❌ Refactor's core success criterion goes unverified.

## Follow-up

Once this refactor lands, a future ADR can propose adopting an automated visual-regression harness (`react-native-owl`, Storybook + `jest-image-snapshot`, or similar) for ongoing protection. This ADR does not preclude that work — it just keeps it out of the style-cleanup PR's scope.

## More Information

- `.claude/plans/style-cleanup/PROJECT.md` (decision D12; success criterion R8)
- `.claude/plans/style-cleanup/research/PITFALLS.md` (C3 Android shadow, m5 Inter font fallback)
- `.claude/plans/style-cleanup/phases/06-enforcement-and-verification/PLAN.md` (task 6.7)
- Related: [ADR-0001](./0001-consolidate-on-nativewind-styling.md), [ADR-0002](./0002-darkmode-class-strategy.md)
