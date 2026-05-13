# 0006: Lint enforcement: `error` in reachable, `warn` elsewhere

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Engineering team
**Tags:** mobile, lint, quality

## Context and Problem Statement

After the style-cleanup refactor lands ([ADR-0001](./0001-consolidate-on-nativewind-styling.md)), we need a way to _prevent regression_. Without lint enforcement, the next PR that adds a `StyleSheet.create(...)` block silently re-fragments the styling system.

Mobile contains files that are no longer reachable from `_layout.tsx` or API route entry points (skipped during the refactor and listed in `apps/mobile/DEAD-CODE.md`, per the project's deferred-deletion stance). Forcing those files to immediately comply with the new lint rules would:

- Conflict with the "mark, don't delete" decision in PROJECT.md.
- Either fail lint or require dead code to be touched solely for compliance.

We need an enforcement level that _blocks regression in live code_ without _forcing dead code to be modified_.

## Decision Drivers

- Prevent silent re-fragmentation of the styling system.
- Don't force changes to files we've decided to defer.
- Don't add new dependencies (no `eslint-plugin-tailwindcss`, no `eslint-plugin-react-native` — see [ADR-0008](./0008-style-cleanup-dependency-policy.md)).
- Be actionable — every lint error must have a clear remediation.

## Considered Options

1. **`error` for reachable files, `warn` for everything else.** Use ESLint flat-config `files` overrides to apply the rules at `error` level only to globs reachable from entry points. Dead-code files receive the same rules at `warn` level — they'll surface in CI output but don't block.
2. **`error` repo-wide.** Forces dead-code files to also be cleaned or deleted. Conflicts with "mark, don't delete."
3. **`warn` only.** Catches new regressions visually but doesn't block PRs. Risk: warnings get ignored over time.
4. **No lint rule; rely on code review.** Easiest to land but provides no protection between reviews.

## Decision Outcome

Chosen option: **"`error` for reachable files, `warn` for everything else"**, because it blocks the regression vectors we care about (live code) without forcing immediate cleanup of files that are out of scope for this refactor.

Three rules added to `apps/mobile/eslint.config.mjs` via `no-restricted-syntax`:

| #   | What's blocked                         | AST selector                                                                     | Message                                                                                                                                                                       |
| --- | -------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | `StyleSheet.create(...)`               | `CallExpression[callee.object.name='StyleSheet'][callee.property.name='create']` | "Use NativeWind className instead of StyleSheet.create. See `apps/mobile/STYLE.md`."                                                                                          |
| L2  | Inline `style={{...}}` object literals | `JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression`    | "Use className. If unavoidable, prefix the line with one of: `// REANIMATED-EXCEPTION`, `// MEASURED-LAYOUT`, `// DYNAMIC-COLOR`, `// PLATFORM-SHADOW`, `// GESTURE-DRIVEN`." |
| L3  | Imports of `useThemeColor`             | `ImportDeclaration[source.value=/useThemeColor/]`                                | "`useThemeColor` is removed. Use NativeWind tokens (`bg-background`, `text-foreground`, etc.)."                                                                               |

The exception comments from [ADR-0004](./0004-inline-style-exceptions.md) are recognised by an additional rule preprocessor: lines with one of the five recognised markers on the preceding line are excluded from L2.

The reachable glob set is derived from the manual reachability sweep in `apps/mobile/DEAD-CODE.md` (no `knip`, per [ADR-0008](./0008-style-cleanup-dependency-policy.md)).

### Consequences

- ✅ New code can't introduce `StyleSheet.create`, raw `style={{...}}`, or `useThemeColor` imports in reachable files.
- ✅ Dead-code files remain present without blocking CI.
- ✅ CI warnings on dead-code files signal them as candidates for follow-up deletion.
- ⚠️ The "reachable" glob list lives in eslint config and must be kept in sync with `DEAD-CODE.md`. Drift here re-introduces the gap.
- ⚠️ A new exception (e.g. a sixth marker beyond the five in [ADR-0004](./0004-inline-style-exceptions.md)) requires editing the lint rule + writing/updating an ADR.

## Pros and Cons of the Options

### `error` reachable / `warn` elsewhere

- ✅ Blocks regression where it matters.
- ✅ Compatible with "mark, don't delete."
- ❌ Glob list maintenance.

### `error` repo-wide

- ❌ Conflicts with the deferred-deletion decision in PROJECT.md.

### `warn` only

- ❌ Warnings get ignored; rule erodes over time.

### No lint rule

- ❌ Provides zero protection between reviews.

## More Information

- `.claude/plans/style-cleanup/PROJECT.md` (decision D11)
- `.claude/plans/style-cleanup/phases/06-enforcement-and-verification/PLAN.md` (task 6.2)
- `apps/mobile/eslint.config.mjs` (rules wired here)
- Related: [ADR-0001](./0001-consolidate-on-nativewind-styling.md), [ADR-0004](./0004-inline-style-exceptions.md), [ADR-0008](./0008-style-cleanup-dependency-policy.md)
