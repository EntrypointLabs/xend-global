# 0004: Five documented inline-style exception comments

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Engineering team
**Tags:** mobile, styling, lint

## Context and Problem Statement

[ADR-0001](./0001-consolidate-on-nativewind-styling.md) commits to NativeWind classes as the sole styling system. However, NativeWind 4 in React Native has documented edge cases where a `className` cannot substitute for a `style` prop:

| Scenario                                | Why `className` fails                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reanimated animated styles              | `useAnimatedStyle()` runs on the UI thread; it can't read NativeWind's JS-thread class resolution.                                                      |
| Tailwind JIT cannot see runtime strings | `bg-[${runtimeColor}]` is unreachable to the JIT — class never gets generated.                                                                          |
| Measured layout                         | When dimensions depend on `measure()` / `onLayout` callbacks, they must be applied as inline style.                                                     |
| Android shadow / elevation              | `shadow-*` Tailwind utilities behave inconsistently on Android (NativeWind issues #130, #893, #1107, #1018); native `elevation` style is more reliable. |
| Gesture-driven transforms               | `react-native-gesture-handler` writes `style.transform` directly; classes don't apply.                                                                  |

If we ban all inline `style` props, we break working code. If we allow them freely, the refactor's "no visual regression" essence is harder to enforce. We need a middle ground: **allow inline style only when explicitly justified, and make the justification machine-readable.**

## Decision Drivers

- Preserve the lint rule's value — banning `style={{...}}` should still mean something.
- Allow the legitimate exceptions documented in research.
- Make the exception machine-readable so the lint rule can recognise it without manual `eslint-disable-next-line` per call site.
- Document the _reason_ for each exception in code, not in a separate spreadsheet.

## Considered Options

1. **Five comment markers, recognised by the lint rule.** Each `style={{...}}` in source must be preceded by one of: `// REANIMATED-EXCEPTION`, `// MEASURED-LAYOUT`, `// DYNAMIC-COLOR`, `// PLATFORM-SHADOW`, `// GESTURE-DRIVEN`. The ESLint `no-restricted-syntax` rule (see [ADR-0006](./0006-lint-enforcement-policy.md)) treats these as opt-outs.
2. **Generic `eslint-disable-next-line` per site.** No semantic information; just suppresses the rule. Reviewer must infer why.
3. **No marker — trust developer discipline.** Lint rule blocks `style={{...}}` entirely; legitimate exceptions become `style={(props) => ({ ... })}` workarounds or get pushed into wrapper components. Painful.
4. **Wrapper component per exception.** `<AnimatedReanimatedView>`, `<DynamicColorView>`, etc. abstracts the exception into a typed component. Heavier abstraction, smaller call-site surface.

## Decision Outcome

Chosen option: **"Five comment markers, recognised by the lint rule"**, because the markers (a) document intent at the call site, (b) are machine-readable, (c) are tiny — one comment per site — and (d) don't add wrapper components, matching the refactor's anti-abstraction stance.

The five accepted markers:

| Marker                    | When to use                                                                                               | Example                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `// REANIMATED-EXCEPTION` | `style={useAnimatedStyle(...)}` or `useSharedValue`-driven `style={...}` on `Animated.View`               | `// REANIMATED-EXCEPTION`<br>`<Animated.View style={animatedStyle}>`                                    |
| `// MEASURED-LAYOUT`      | Dimensions from `measure()` / `onLayout` callbacks                                                        | `// MEASURED-LAYOUT`<br>`<View style={{ height: measuredHeight }}>`                                     |
| `// DYNAMIC-COLOR`        | Backend-driven color (KYC status tint, transaction-type chip) — Tailwind JIT can't see the runtime string | `// DYNAMIC-COLOR`<br>`<View style={{ backgroundColor: kycTint }}>`                                     |
| `// PLATFORM-SHADOW`      | Shadow or elevation where iOS+Android parity diverges from `shadow-*` utilities                           | `// PLATFORM-SHADOW`<br>`<View style={Platform.select({ ios: shadowIos, android: { elevation: 4 } })}>` |
| `// GESTURE-DRIVEN`       | Transforms written by `react-native-gesture-handler` or `Animated.event`                                  | `// GESTURE-DRIVEN`<br>`<PanGestureHandler onGestureEvent={...}>`                                       |

The comment must appear on the line immediately preceding the inline `style` prop. The ESLint rule whitelists `style={{...}}` only when one of these comments is present.

### Consequences

- ✅ Lint rule retains its value — random `style={{...}}` is still blocked.
- ✅ Every exception is self-documenting at the call site.
- ✅ Reviewers can scan for unexpected markers (e.g. "why is there a `DYNAMIC-COLOR` here?").
- ✅ Adding a sixth exception is one entry in the lint rule + this ADR — low cost.
- ⚠️ Slightly more verbose code at exception sites — one comment line per site.
- ⚠️ Marker names must be stable — renaming them breaks the lint rule. We accept this; the names are deliberately verbose-but-clear.

## Pros and Cons of the Options

### Five comment markers

- ✅ Self-documenting, machine-readable, no new abstractions.
- ❌ Marker name conventions need to be remembered (mitigated by lint error messages naming them).

### Generic `eslint-disable-next-line`

- ✅ Standard ESLint pattern.
- ❌ No semantic info — reviewer must reverse-engineer why.

### No marker, trust discipline

- ❌ Either the lint rule is useless (everyone disables) or legitimate exceptions become hard to land.

### Wrapper component per exception

- ✅ Type-safe abstraction.
- ❌ More files, more abstractions — violates the "no new abstractions" stance of the style-cleanup refactor.

## More Information

- `.claude/plans/style-cleanup/PROJECT.md` (decision D5)
- `.claude/plans/style-cleanup/research/PITFALLS.md` (full pitfall enumeration: C1 Reanimated, C2 cascade, C3 Android shadow, C4 SafeAreaView, C5 Pressable-in-nav, M2 dynamic colors)
- `.claude/plans/style-cleanup/phases/06-enforcement-and-verification/PLAN.md` (task 6.2 — lint rule wiring)
- Related: [ADR-0006](./0006-lint-enforcement-policy.md)
