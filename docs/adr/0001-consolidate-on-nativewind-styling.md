# 0001: Consolidate on NativeWind 4 + CSS-variable tokens as the sole styling system

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Engineering team
**Tags:** mobile, styling

## Context and Problem Statement

The `apps/mobile` codebase has accumulated **three competing styling systems** running in parallel:

| System                   | Example                                     | Files |
| ------------------------ | ------------------------------------------- | ----- |
| `StyleSheet.create(...)` | `PasskeySetupModal.tsx`, `ThemedButton.tsx` | 49    |
| Inline `style={{...}}`   | Many screens, conditional opacity/disabled  | 17    |
| NativeWind `className`   | `bankdetails.tsx`, newer screens            | 33    |

Many files mix all three on the same element. On top of this fragmentation, a JS-side theme layer (`useThemeColor` + `Colors.ts` + `Theme.ts` + `ScreenThemeContext`) re-implements what NativeWind's `dark:` variants and CSS-variable tokens already provide. The result is high cognitive overhead per component, duplicated palette values (`#34C759` appears in 6+ files), and inconsistent reuse.

Newer components have been written in NativeWind; the convention is clear, but it has never been formalised or enforced.

## Decision Drivers

- Reduce fragmentation: one styling layer is easier to learn, review, and refactor than three.
- Match the destination already chosen by newer components (`bankdetails.tsx`, `kyc.tsx`).
- Enable declarative theming via Tailwind tokens instead of imperative `useThemeColor` lookups.
- Preserve runtime behaviour: this is a refactor, not a redesign. No visual regression is the core success criterion.
- Don't add new abstractions or dependencies for the sake of consolidation.

## Considered Options

1. **Consolidate on NativeWind 4 + CSS-variable tokens.** Migrate all `StyleSheet` blocks and inline `style` props to `className`. Replace the JS theme layer with Tailwind config tokens driven by CSS variables in `global.css`.
2. **Consolidate on StyleSheet + a hand-rolled theme.** Migrate NativeWind back to StyleSheet. Keep `useThemeColor` and expand it.
3. **Adopt a third styling library** (e.g. `tamagui`, `restyle`, `unistyles`). Replace all three current systems with the new one.
4. **Leave it.** Continue with mixed styling; rely on team convention.

## Decision Outcome

Chosen option: **"Consolidate on NativeWind 4 + CSS-variable tokens"**, because NativeWind is already in the dependency tree, newer code already uses it, and class-based styling collapses three concerns (layout, color, conditional state) into a single string consumable by `cn()`.

The migration runs as a single-sweep refactor across `apps/mobile/` documented in `.claude/plans/style-cleanup/`. The PR is structured in six internal phases (Foundation → Atoms → Molecules → Organisms+Layouts → Screens+Contexts → Enforcement+Verification) but lands as one merge.

### Consequences

- ✅ Single styling vocabulary across the mobile app.
- ✅ Theme tokens live in one place (`global.css` + `tailwind.config.js`); dark mode becomes a class variant rather than a JS lookup.
- ✅ Less code per component — average component shrinks by 30-50% of styling boilerplate.
- ✅ Reviewer time drops — one mental model instead of three.
- ⚠️ Refactor cost is real — touching ~80 files across `apps/mobile/`.
- ⚠️ Some NativeWind-specific pitfalls (Reanimated, Pressable-in-nav, Android shadow parity) require care. Documented in [ADR-0004](./0004-inline-style-exceptions.md).
- ⚠️ Dynamic backend colors (Tailwind JIT can't see runtime strings) need explicit inline-style exceptions.

## Pros and Cons of the Options

### NativeWind 4 + CSS-variable tokens

- ✅ Already in `package.json`; newer components use it.
- ✅ Tailwind tokens + `dark:` variants replace `useThemeColor` declaratively.
- ✅ `className` co-locates styling with markup — easier to scan.
- ❌ Some React Native primitives (`SafeAreaView`, `KeyboardAvoidingView`) need explicit `cssInterop` registration.
- ❌ Reanimated worklets cannot animate `className` — animated styles still need `style={useAnimatedStyle(...)}`.

### StyleSheet + hand-rolled theme

- ✅ No new conventions; everything is plain RN.
- ❌ More code per component; styles live far from markup.
- ❌ Reverses the direction newer code is already heading.

### Third styling library (Tamagui / restyle / unistyles)

- ✅ More expressive (typed tokens, runtime theming).
- ❌ Adds a new dependency, new mental model, new edge cases.
- ❌ Migration cost similar to consolidating on NativeWind but with no existing usage to build on.

### Leave it

- ❌ Continues the fragmentation pain and decision overhead per PR.
- ❌ Newer contributors mirror whichever pattern they see first, deepening the inconsistency.

## More Information

- `.claude/plans/style-cleanup/PROJECT.md` — full vision and success criteria
- `.claude/plans/style-cleanup/ROADMAP.md` — 6-phase migration plan
- `.claude/plans/style-cleanup/STATE.md` — codebase audit that identified the three systems
- `.claude/plans/style-cleanup/research/SUMMARY.md` — cross-cutting research findings
- [NativeWind 4 announcement](https://www.nativewind.dev/blog/announcement-nativewind-v4)
- Related: [ADR-0002](./0002-darkmode-class-strategy.md), [ADR-0003](./0003-semantic-token-taxonomy.md), [ADR-0004](./0004-inline-style-exceptions.md), [ADR-0005](./0005-typography-canonical-text-api.md), [ADR-0006](./0006-lint-enforcement-policy.md), [ADR-0007](./0007-defer-screentheme-context-removal.md), [ADR-0008](./0008-style-cleanup-dependency-policy.md), [ADR-0009](./0009-visual-regression-strategy.md)
