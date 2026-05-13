# 0008: Style-cleanup dependency policy: pin `tailwind-merge` to `^2.6.0`, no new deps

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Engineering team
**Tags:** mobile, dependencies, styling

## Context and Problem Statement

Research during the style-cleanup planning surfaced two dependency questions:

1. **`tailwind-merge` is pinned at `^3.4.0`** — but `tailwind-merge` v3+ only supports Tailwind v4. The current stack is Tailwind v3.4.17 + NativeWind 4.2.1, so every `cn()` call **silently mis-merges conflicting classes**. This is a latent bug, not "everything's working." (See `tailwind-merge` v3.0.0 release notes.)
2. **`knip` is the recommended tool** for the `DEAD-CODE.md` reachability report (`ts-prune` is archived, `madge` doesn't see expo-router file-based routes).

PROJECT.md explicitly states "no new dependencies." This conflicts with adopting `knip`, but the `tailwind-merge` issue is a bug fix (downgrade, not add). The dependency policy for this refactor needs to be explicit.

## Decision Drivers

- Fix the silent `cn()` mis-merge — it currently produces incorrect class strings and undermines the refactor's correctness.
- Honour the spirit of "no new dependencies" — avoid churn, avoid adding runtime bloat, prefer existing tools.
- Strict reading vs. pragmatic reading — does "no new deps" include `devDependencies`?
- Produce `DEAD-CODE.md` in some form, even without `knip`.

## Considered Options

1. **Pin `tailwind-merge` to `^2.6.0`; no other dependency changes (including no `knip`). Produce `DEAD-CODE.md` via manual `rg`/grep heuristics.** Strict reading of "no new deps."
2. **Pin `tailwind-merge` to `^2.6.0`; add `knip` as a `devDependency` only.** Pragmatic reading — devDeps don't ship to users.
3. **Leave `tailwind-merge` at `^3.4.0`; accept the mis-merge.** No dep changes at all. Refactor produces incorrect class strings.
4. **Upgrade to Tailwind v4 + the new `tailwind-merge` v3.** Aligns with the v3 pin, but NativeWind 4 has not certified Tailwind v4 — high regression risk.

## Decision Outcome

Chosen option: **"Pin `tailwind-merge` to `^2.6.0`; no other dependency changes (including no `knip`). Produce `DEAD-CODE.md` via manual `rg`/grep heuristics."**

Rationale:

- The `tailwind-merge` downgrade is treated as a **bug fix**, not a new dependency. The package was already pinned; we're correcting the pin to the version that matches the rest of the stack.
- Even devDep changes carry maintenance overhead (`npm install` time, security audit surface, lockfile churn). For a refactor whose value is in DX consolidation, adding tooling churn cuts against the spirit.
- A manual `rg`-driven reachability sweep is mechanical and produces a comparable `DEAD-CODE.md`. We accept the bit of human time over the dependency.

Concrete changes in the style-cleanup refactor:

| Package                                          | Current           | Target            | Reason                                                                |
| ------------------------------------------------ | ----------------- | ----------------- | --------------------------------------------------------------------- |
| `tailwind-merge`                                 | `^3.4.0`          | `^2.6.0`          | Bug fix — match Tailwind v3 / NativeWind 4                            |
| `tailwindcss`                                    | `^3.4.17`         | unchanged         | NativeWind 4 has not certified Tailwind v4                            |
| `nativewind`                                     | `^4.2.1`          | unchanged         | Recent enough; verified during Phase 1 spike                          |
| `clsx`                                           | `^2.1.1`          | unchanged         | Already compatible                                                    |
| `prettier-plugin-tailwindcss`                    | already installed | unchanged         | Handles class ordering — removes need for `eslint-plugin-tailwindcss` |
| `knip`                                           | not installed     | **NOT installed** | Manual reachability instead                                           |
| `eslint-plugin-tailwindcss`                      | not installed     | **NOT installed** | NativeWind false positives, overlap with prettier plugin              |
| `eslint-plugin-react-native`                     | not installed     | **NOT installed** | Use ESLint `no-restricted-syntax` (zero new deps)                     |
| `class-variance-authority` / `tailwind-variants` | not installed     | **NOT installed** | Anti-feature per PROJECT.md — no new abstractions                     |
| `apps/mobile/nativewind-env.d.ts` (new file)     | —                 | added             | TS type triple-slash reference; no runtime dep                        |

### Consequences

- ✅ `cn()` mis-merge is fixed; classes resolve correctly.
- ✅ Zero new runtime dependencies; zero new devDeps.
- ✅ No new tooling to learn or maintain.
- ⚠️ `DEAD-CODE.md` is produced manually — bit slower than `knip` and dependent on reviewer diligence.
- ⚠️ If future refactors _do_ want `knip`, this ADR doesn't preclude it — a new ADR can supersede or extend this policy.

## Pros and Cons of the Options

### Pin + no other deps (manual reachability)

- ✅ Strict honour of "no new deps."
- ✅ Bug fix lands.
- ❌ Manual reachability work.

### Pin + knip (devDep only)

- ✅ Better reachability output.
- ❌ Reading of "no new deps" is more permissive than PROJECT.md intent.

### Leave `tailwind-merge` at v3

- ❌ Silent mis-merge persists. Refactor produces incorrect classes.

### Upgrade Tailwind to v4

- ❌ NativeWind 4 has not certified Tailwind v4 — high regression risk.

## More Information

- `.claude/plans/style-cleanup/PROJECT.md` (decisions D1, D2)
- `.claude/plans/style-cleanup/research/STACK.md` (`tailwind-merge` v2 vs v3 analysis)
- `.claude/plans/style-cleanup/research/SUMMARY.md` (version pins table)
- [`tailwind-merge` v3.0.0 release notes](https://github.com/dcastil/tailwind-merge/releases/tag/v3.0.0)
- [`dcastil/tailwind-merge#468` (Tailwind v4 discussion)](https://github.com/dcastil/tailwind-merge/discussions/468)
- [Knip vs ts-prune migration guide](https://knip.dev/explanations/comparison-and-migration)
- Related: [ADR-0001](./0001-consolidate-on-nativewind-styling.md), [ADR-0006](./0006-lint-enforcement-policy.md)
