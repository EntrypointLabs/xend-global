# 0005: `Typography` is the canonical text component; deprecate `ThemedText`

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Engineering team
**Tags:** mobile, components, text

## Context and Problem Statement

The mobile app has **two parallel text components**:

| Component                                        | API                                                   | Implementation                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/mobile/components/ui/atoms/Typography.tsx` | `<Typography weight="600" size="lg">...</Typography>` | className-based variants, uses `cn()`                                                                     |
| `apps/mobile/components/ui/atoms/ThemedText.tsx` | `<ThemedText type="title">...</ThemedText>`           | `StyleSheet.create` + a `type` enum (`"default" \| "title" \| "subtitle" \| "defaultSemiBold" \| "link"`) |

Both have callers across the codebase. New components have started using `Typography`; older code uses `ThemedText`. The fragmentation means:

- Type variants in `ThemedText` (e.g. `defaultSemiBold`) don't map cleanly to `Typography`'s weight/size pair without a manual conversion.
- Color is hard-coded in `ThemedText` (light/dark hex literals); `Typography` defers color to the parent's NativeWind class context.
- Reviewers and contributors must remember which one to use, and the rule is "the one your neighbour file used."

[ADR-0001](./0001-consolidate-on-nativewind-styling.md) commits to NativeWind classes; `Typography` is already there.

## Decision Drivers

- Single component per concept reduces cognitive load.
- Align with the className-first direction of the broader refactor.
- Don't break consumers — migration path must be incremental.
- Preserve semantic clarity — `<ThemedText type="title">` was readable; the replacement should be too.

## Considered Options

1. **Keep `Typography`; migrate then delete `ThemedText`.** Replace every `ThemedText` import with `Typography`. During the migration, `ThemedText.tsx` becomes a thin re-export `export { Typography as ThemedText }` for one beat, then deletes once all call sites are migrated.
2. **Keep `ThemedText`; migrate `Typography` callers to it.** Preserves the semantic `type="title"` enum. Convert `ThemedText` internals to className.
3. **Build a new third component that supersedes both.** Clean break, but doubles the migration cost and adds a third concept temporarily.

## Decision Outcome

Chosen option: **"Keep `Typography`; migrate then delete `ThemedText`"**, because:

- `Typography` is already className-based — no internal conversion needed.
- The `type="title"` semantic can be preserved via prop conventions (`<Typography size="3xl" weight="700">`) or, optionally, by adding a `variant` prop to `Typography` if a single attribute is missed.
- The migration is mechanical: each `ThemedText` call site has a known type-to-props mapping, captured in `phases/02-atoms/THEMED-TEXT-MIGRATION.md` during the migration.

`ThemedText.tsx` is replaced with a one-line re-export shim during Phase 2 of the style-cleanup migration; the shim is deleted in Phase 5 after all imports are migrated.

### Consequences

- ✅ One canonical text component across the app.
- ✅ Color is handled at the parent class context, not hard-coded — dark mode works automatically.
- ✅ Migration is incremental — the re-export shim keeps the working tree green while imports are updated.
- ⚠️ Existing `<ThemedText type="title">` call sites must be updated; ~20 files touched.
- ⚠️ Anyone with `<ThemedText>` in a half-finished branch will need to rebase/replace.

## Pros and Cons of the Options

### Keep `Typography`; deprecate `ThemedText`

- ✅ Already className-based.
- ✅ Mechanical migration.
- ❌ Loses the single-prop `type="title"` shape (mitigated by adding `variant` prop if needed).

### Keep `ThemedText`; deprecate `Typography`

- ✅ Single-attribute semantic clarity.
- ❌ Requires converting `ThemedText` internals to className anyway.
- ❌ More call sites to migrate (newer code already uses `Typography`).

### Build a new third component

- ❌ Doubles migration cost.
- ❌ Adds a third concept transiently.

## More Information

- `.claude/plans/style-cleanup/PROJECT.md` (decisions D7, D13)
- `.claude/plans/style-cleanup/phases/02-atoms/PLAN.md` (tasks 2.1, 2.7, 2.8 — migration + shim)
- `.claude/plans/style-cleanup/phases/05-screens-and-contexts/PLAN.md` (task 5.9 — shim deletion)
- Related: [ADR-0001](./0001-consolidate-on-nativewind-styling.md), [ADR-0003](./0003-semantic-token-taxonomy.md)
