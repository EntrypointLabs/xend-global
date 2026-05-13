# 0002: `darkMode: "class"` strategy with `useColorScheme` from nativewind

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Engineering team
**Tags:** mobile, styling, theming

## Context and Problem Statement

NativeWind 4 supports two dark-mode strategies:

- **Media-query strategy** (default) — `dark:` variants apply automatically when the OS reports a dark color scheme. No JS state, no manual override possible.
- **Class strategy** (`darkMode: "class"`) — `dark:` variants apply when an ancestor element has the `dark` class. JS state controls this via `colorScheme.set()`.

The current mobile app automatically follows system preference, which media-query handles trivially. However:

1. The auth-flow screens force a **dark canvas regardless of system setting** (driven today by `useScreenTheme` + `Colors.dark`). This requires a JS-controlled override.
2. Future user-facing theme toggles (in-app "always dark" / "always light" preferences) require a JS-controlled override.
3. NativeWind 4 throws at runtime if `colorScheme.set()` is called without `darkMode: "class"` (GitHub issue #587).

## Decision Drivers

- Preserve the auth-flow forced-dark canvas after we remove `useScreenTheme`'s JS theme layer.
- Keep the door open for a user theme preference without another migration.
- Avoid the GH#587 runtime error.
- Continue auto-switching with system preference by default (current UX).

## Considered Options

1. **`darkMode: "class"` + `useColorScheme()` from `nativewind`.** Class strategy; the hook tracks system preference _and_ exposes `setColorScheme()` for manual overrides.
2. **Media-query strategy (default).** Auto-switches with system. No JS override; the auth forced-dark canvas would need a different solution (e.g. force `dark:` classes on auth-group root manually).
3. **Class strategy without the nativewind hook.** Manage the `dark` class ourselves from `useColorScheme()` (RN core). More code, no benefit over option 1.

## Decision Outcome

Chosen option: **"`darkMode: \"class\"` + `useColorScheme()` from `nativewind`"**, because it satisfies both the current forced-dark auth-canvas need and any future theme-preference work, and the nativewind hook is purpose-built to follow system preference until manually overridden.

Implementation:

- `apps/mobile/tailwind.config.js` sets `darkMode: "class"`.
- `apps/mobile/app/_layout.tsx` reads `useColorScheme()` from `nativewind` and wraps children in a `<View className={theme === "dark" ? "dark flex-1" : "flex-1"}>`.
- A thin `apps/mobile/hooks/useTheme.ts` re-exports the hook under the codebase's preferred name.

### Consequences

- ✅ The auth-flow forced-dark canvas survives the removal of `useScreenTheme`.
- ✅ Adding a user theme toggle later is a small change — call `setColorScheme("dark")`.
- ✅ No GH#587 runtime errors when toggling.
- ⚠️ The root layout now has a `<View className="dark ...">` wrapper that wasn't there before — a small extra render-tree node.
- ⚠️ Class-strategy means the `dark` class must propagate through every wrapping component; third-party wrappers without className support need `cssInterop` registration.

## Pros and Cons of the Options

### `darkMode: "class"` + nativewind `useColorScheme`

- ✅ One hook handles auto-switch and manual override.
- ✅ Future-compatible with a user theme preference.
- ❌ Tiny extra render-tree node at the root.

### Media-query strategy

- ✅ Zero JS state.
- ❌ No manual override — can't force auth dark canvas without working around it.
- ❌ Future theme-preference work requires migrating to class strategy anyway.

### Class strategy with RN-core `useColorScheme`

- ✅ No nativewind hook dependency.
- ❌ More code, no functional benefit over option 1.

## More Information

- `.claude/plans/style-cleanup/PROJECT.md` (decision D4)
- `.claude/plans/style-cleanup/research/ARCHITECTURE.md` (NativeWind 4 darkMode discussion + GH#587)
- [NativeWind dark mode docs](https://www.nativewind.dev/docs/core-concepts/dark-mode)
- [GH#587 — class strategy required for manual override](https://github.com/nativewind/nativewind/issues/587)
- Related: [ADR-0001](./0001-consolidate-on-nativewind-styling.md), [ADR-0007](./0007-defer-screentheme-context-removal.md)
