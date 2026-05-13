# 0007: Defer `ScreenThemeContext` removal to a follow-up PR

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Engineering team
**Tags:** mobile, components, theming, scope

## Context and Problem Statement

`apps/mobile/contexts/ScreenThemeContext.tsx` provides per-screen theme overrides — most notably, the auth-flow screens force a dark canvas regardless of system preference. It's consumed by **17 files**, primarily under `app/(auth)/*` and `app/(modals)/*`, via the `useScreenTheme()` hook and the `WithScreenTheme` HOC.

The style-cleanup refactor ([ADR-0001](./0001-consolidate-on-nativewind-styling.md)) replaces the JS theme layer (`useThemeColor`, `Colors.ts`, `Theme.ts`) with NativeWind tokens. Architecturally, `ScreenThemeContext` could be deleted too — the dark canvas can be expressed as `bg-foreground` (or a forced `dark` class) at the `app/(auth)/_layout.tsx` level.

However, deleting the context in the same PR means:

- Touching all 17 dependent files in the same diff.
- Higher visual-regression risk in the auth flow — the most security-sensitive part of the app.
- A larger blast radius for any unexpected NativeWind behaviour in dark mode.

The single-sweep refactor is already large; adding ScreenThemeContext removal stretches the diff further.

## Decision Drivers

- Minimise blast radius — keep the style refactor focused on style.
- Reduce visual-regression risk in the auth flow.
- Preserve the option to remove `ScreenThemeContext` later without lock-in.
- Keep the lint rule from blocking on a known-deferred construct.

## Considered Options

1. **Defer removal; convert internals in this PR.** Keep the `useScreenTheme()` hook and `<ScreenThemeProvider>` API. Convert the `<ScreenThemeProvider>`'s internal styling from inline style props to className. All 17 dependents continue to work unchanged.
2. **Remove now; replace with hard-coded `bg-foreground` at `app/(auth)/_layout.tsx`.** Smaller end-state surface; bigger PR; higher auth-flow regression risk.
3. **Remove now with a screenshot-diff gate.** Same as option 2, but require per-screen iOS+Android screenshot diffs for every auth/modal screen before merge. Highest cost.

## Decision Outcome

Chosen option: **"Defer removal; convert internals in this PR"**, because:

- It keeps the style-cleanup PR focused on style replacement, not API removal.
- 17 call sites continue calling `useScreenTheme()` with no change — zero migration cost for consumers.
- The internal styling of `ScreenThemeProvider` still gets converted to className, so the styling-consolidation success criteria still apply to its render output.
- Removal becomes a small, isolated follow-up PR where the only concern is "does the auth canvas still flip to dark?"

The lint rule from [ADR-0006](./0006-lint-enforcement-policy.md) does **not** flag `useScreenTheme` imports, only `useThemeColor` imports. `ScreenThemeContext`'s deferred status is documented here and in `PROJECT.md`.

### Consequences

- ✅ Style-cleanup PR is smaller and less risky.
- ✅ Auth-flow visual regression risk concentrated into a future, focused PR.
- ✅ 17 consumer files unchanged.
- ⚠️ `ScreenThemeContext` remains as a parallel theme mechanism alongside NativeWind tokens. Mitigated by the fact that its internal styling now uses tokens, so the values stay in sync.
- ⚠️ Deferred work — someone has to do it later. Captured here so it doesn't get forgotten.

## Pros and Cons of the Options

### Defer removal; convert internals

- ✅ Smaller PR, lower auth-flow risk.
- ✅ Zero migration cost for 17 consumers.
- ❌ Leaves a parallel theme construct in place transiently.

### Remove now (no diff gate)

- ✅ Cleaner end-state.
- ❌ Larger PR; harder review; higher regression risk.

### Remove now with screenshot diff gate

- ✅ Cleanest end-state with regression protection.
- ❌ Highest cost; review gate is heavy.

## Follow-up

A future ADR will supersede or supplement this one when `ScreenThemeContext` is removed. The expected steps:

1. Move auth-canvas forcing logic to `app/(auth)/_layout.tsx` (`<View className="dark flex-1">` or equivalent).
2. Remove `WithScreenTheme` HOC; replace each call site with the equivalent NativeWind class.
3. Delete `apps/mobile/contexts/ScreenThemeContext.tsx`.
4. Delete `apps/mobile/constants/Theme.ts` if no other consumers remain.
5. Visual diff on auth + modal screens.

## More Information

- `.claude/plans/style-cleanup/PROJECT.md` (decision D3)
- `.claude/plans/style-cleanup/STATE.md` (17 dependents enumerated)
- `.claude/plans/style-cleanup/phases/05-screens-and-contexts/PLAN.md` (task 5.7 — internal conversion only)
- Related: [ADR-0001](./0001-consolidate-on-nativewind-styling.md), [ADR-0002](./0002-darkmode-class-strategy.md)
