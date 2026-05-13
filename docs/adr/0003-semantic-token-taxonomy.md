# 0003: Semantic token taxonomy: HSL CSS vars, incremental minimal set

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Engineering team
**Tags:** mobile, styling, design-system

## Context and Problem Statement

The mobile app currently defines design tokens in three competing places:

- `apps/mobile/constants/Colors.ts` — `Colors.light` / `Colors.dark` keys (`background`, `text`, `tint`, `icon`, `tabIconDefault`, `tabIconSelected`)
- `apps/mobile/constants/Theme.ts` — a parallel theme structure consumed by `ScreenThemeContext`
- Hardcoded hex literals scattered across 38 files — `#34C759` (success/green), `#FF3B30` (destructive/red), `#F90101` (also red, in `settings.tsx` logout), `#007AFF` (info/blue)

There is no single source of truth, and the duplicated semantic hexes (`#34C759` in 6+ files) drift over time. The migration to NativeWind needs a token taxonomy that:

- Replaces both `Colors.ts` and `Theme.ts` as the source of truth.
- Supports `dark:` variants without per-call lookups.
- Supports Tailwind opacity modifiers (`bg-primary/20`) — required by ~9 sites currently using `tinycolor().setAlpha()`.
- Doesn't introduce so many tokens that the design surface becomes incoherent.

## Decision Drivers

- Single source of truth — tokens defined in one place, consumed everywhere.
- Opacity modifiers work — `bg-token/20` must produce the same effect as `tinycolor().setAlpha(0.2)`.
- Dark mode trivial — adding a dark variant is one CSS line, not a JS branch.
- Don't pre-define tokens we don't use — design surface stays coherent.
- Match an industry convention — newcomers should recognise the shape.

## Considered Options

1. **HSL CSS variables, shadcn convention, minimal incremental set.** Tokens live as space-separated HSL triplets in `global.css` (`:root` for light, `.dark:root` for dark). `tailwind.config.js` references them via `hsl(var(--token) / <alpha-value>)`. Start with the existing `Colors.light/dark` keys + three promoted semantic hexes (`success`, `destructive`, `info`); add others only when a converted call site needs them.
2. **Full shadcn token set up-front.** Define all 14 shadcn-style tokens (`background`, `foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `accent`, `accent-foreground`, `muted`, `muted-foreground`, `destructive`, `destructive-foreground`, `border`, `ring`) before conversion starts. Most won't have call sites yet.
3. **Hex values directly in Tailwind config.** `colors: { background: { DEFAULT: "#fff", dark: "#000" } }`. No CSS vars. Opacity-modifier syntax behaves differently on `{ DEFAULT, dark }` objects (GH discussions inconclusive).
4. **Keep `Colors.ts` as the source; expose it through Tailwind via a JS function.** Bridges the gap but keeps two systems.

## Decision Outcome

Chosen option: **"HSL CSS variables, shadcn convention, minimal incremental set"**, because:

- HSL triplets with `<alpha-value>` substitution is the only pattern that lets `bg-token/20` opacity modifiers work reliably on light + dark token pairs.
- CSS vars are the canonical shadcn / react-native-reusables idiom — recognised by anyone arriving from that ecosystem.
- Starting minimal avoids speculative design choices; tokens grow from real call-site needs.

Initial token set (seeded into `global.css` at the start of the migration):

| Token                                    | Light source              | Dark source                  | Promoted from                                     |
| ---------------------------------------- | ------------------------- | ---------------------------- | ------------------------------------------------- |
| `background`                             | `Colors.light.background` | `Colors.dark.background`     | existing                                          |
| `foreground`                             | `Colors.light.text`       | `Colors.dark.text`           | existing (renamed from `text`)                    |
| `primary` (`tint`)                       | `Colors.light.tint`       | `Colors.dark.tint`           | existing                                          |
| `success`                                | `#34C759`                 | (dark: slightly desaturated) | hardcoded hex (6 files)                           |
| `destructive`                            | `#FF3B30`                 | (dark variant)               | hardcoded hex (`#FF3B30`, `#F90101` consolidated) |
| `info`                                   | `#007AFF`                 | (dark variant)               | hardcoded hex                                     |
| `icon`                                   | `Colors.light.icon`       | `Colors.dark.icon`           | existing                                          |
| `tab-icon-default` / `tab-icon-selected` | from `Colors`             | from `Colors`                | existing                                          |

Additional tokens (`muted`, `accent`, `border`, `ring`, etc.) are added only when a converted component needs them. Each addition is documented in the commit message.

### Consequences

- ✅ One source of truth: `global.css` for values, `tailwind.config.js` for the API.
- ✅ `bg-token/20` opacity modifiers work everywhere — replaces 9 `tinycolor`/string-concat sites.
- ✅ Dark mode is one extra CSS line per token.
- ✅ Token surface stays coherent; design choices are deliberate.
- ⚠️ HSL conversions from existing hex are mechanical but tedious — every converted token needs pixel-equivalence verification.
- ⚠️ Incremental growth means the token list isn't "complete" at any single moment — readers must check `global.css` for the current set.
- ⚠️ A spike on NativeWind 4.2.1 was required to confirm `<alpha-value>` substitution works with `{ DEFAULT, dark }` token shape (see plan Phase 1 task 1.9). Outcome documented in `phases/01-foundation/SPIKE-RESULT.md`.

## Pros and Cons of the Options

### HSL CSS variables, minimal incremental set

- ✅ shadcn convention — familiar.
- ✅ Opacity modifiers work.
- ✅ Token set grows from usage, not speculation.
- ❌ Initial migration cost (HSL conversion).

### Full shadcn token set up-front

- ✅ "Complete" design system from day 1.
- ❌ Many tokens with no call sites; risk of premature design decisions.
- ❌ Larger initial CSS file with values that may never be used.

### Hex values directly in Tailwind config

- ✅ Simpler config.
- ❌ Opacity-modifier behaviour with `{ DEFAULT, dark }` is fragile and undocumented for our NativeWind version.

### Keep `Colors.ts` as the source, bridged via JS

- ❌ Maintains two parallel systems; risks drift.
- ❌ JS bridge has runtime cost on every class resolve.

## More Information

- `.claude/plans/style-cleanup/PROJECT.md` (decisions D6, D10, D13)
- `.claude/plans/style-cleanup/research/ARCHITECTURE.md` (token taxonomy + HSL conversion table)
- `.claude/plans/style-cleanup/phases/01-foundation/PLAN.md` (tasks 1.4, 1.5, 1.9)
- [shadcn theming convention](https://ui.shadcn.com/docs/theming)
- [NativeWind themes guide](https://www.nativewind.dev/docs/guides/themes)
- Related: [ADR-0001](./0001-consolidate-on-nativewind-styling.md), [ADR-0002](./0002-darkmode-class-strategy.md)
