# 0011: Upgrade Expo SDK from 54 to 56 for Privy compatibility

**Status:** Accepted
**Date:** 2026-05-30
**Deciders:** Xend mobile team (executor-4a of Xend Grid migration Phase 4)
**Tags:** mobile, expo, dependencies, privy

## Context and Problem Statement

The Xend Grid migration replaces Squads Grid with Privy as the embedded
wallet / signing layer. The pinned mobile SDK is `@privy-io/expo@0.67.1`
(decision locked in the Phase 1 "Privy SDK Decisions" table after the
Privy-on-Solana spike). The Phase 1 spike harness at `spike/privy-solana`
was scaffolded against **Expo SDK ~56.0.8**; `@privy-io/expo@0.67.1` and
its peer `@privy-io/expo-native-extensions@0.0.11` require this SDK
generation (their config plugins and native modules depend on RN 0.85.x

- Expo Modules 56 APIs).

Xend mobile (`apps/mobile`) is currently on **Expo SDK ~54.0.33 / React
Native 0.81.5**. Without the upgrade, the Phase 4 mobile cutover cannot
install Privy: peer-dep resolution and the iOS/Android native build
would both fail.

A secondary motivation: the workspace root `package.json` carried stale
overrides for `expo`, `react`, `react-native`, and
`react-native-worklets` that pinned them to the SDK 54 generation. With
the root and `apps/mobile` out of sync, the workspace ended up with two
copies of `react-native` in different positions (root + app), causing
TypeScript to see incompatible duplicate `StyleSheet` and `ViewStyle`
types across the source tree. This had to be aligned in the same pass.

## Decision Drivers

- Privy Expo SDK `0.67.1` will not install or run under Expo 54.
- Migration ADR `0010-no-load-bearing-provider` requires that no single
  external provider be load-bearing for the app; before we can swap
  Privy for Turnkey or Crossmint later, we must first make Privy work.
- The spike harness pinned `expo@~56.0.8`; staying on the same SDK
  generation as the spike de-risks Phase 4 verification (spike behaviour
  transfers).
- Expo 57 is not yet on Privy's compatibility matrix; skipping ahead
  would add risk without payoff. The current Expo release page confirms
  56.x is the supported floor.
- Workspace hoisting means root and app SDK versions must agree, or
  TypeScript will surface duplicate-type errors across hundreds of
  files.

## Considered Options

1. **Upgrade Expo to 56.x in `apps/mobile` and align the workspace
   root.** Picks up the SDK generation Privy needs; spike behaviour
   transfers; one duplicate-type cluster to clean up.
2. **Stay on Expo 54 and downgrade Privy to a 0.6x.y line that still
   supports Expo 54.** Avoids the SDK bump but resurrects two risks: (a)
   the Phase 1 spike used 0.67.1, so spike findings would no longer
   apply, and (b) Privy's older lines have already shed the
   `useEmbeddedSolanaWallet` shape we coded against.
3. **Jump to Expo 57.** Latest, but neither Privy nor the spike has been
   exercised against it; introduces unknown native-build breakage.

## Decision Outcome

Chosen option: **"Upgrade Expo to 56.x in `apps/mobile` and align the
workspace root."**, because it is the option the Phase 1 spike validated
and the only one that lets us install `@privy-io/expo@0.67.1` as
specified.

Concretely:

- `apps/mobile/package.json`: `expo` bumped from `~54.0.33` to
  `~56.0.0`; ran `npx expo install --fix` to align every Expo-managed
  peer dep (`react-native@0.85.3`, `react@19.2.3`, `react-dom@19.2.3`,
  `react-native-reanimated@4.3.1`, `react-native-svg@15.15.4`,
  `react-native-webview@13.16.1`, `expo-router@~56.2.8`,
  `expo-clipboard@~56.0.3`, `expo-secure-store@~56.0.4`,
  `expo-web-browser@~56.0.5`, `expo-blur@~56.0.3`,
  `expo-camera@~56.0.7`, `expo-constants@~56.0.16`,
  `expo-dev-client@~56.0.18`, `expo-font@~56.0.5`,
  `expo-haptics@~56.0.3`, `expo-image@~56.0.9`, `expo-linking@~56.0.13`,
  `expo-splash-screen@~56.0.10`, `expo-status-bar@~56.0.4`,
  `expo-symbols@~56.0.5`, `expo-system-ui@~56.0.5`,
  `react-native-gesture-handler@~2.31.1`,
  `react-native-safe-area-context@~5.7.0`,
  `react-native-screens@4.25.2`, `@sentry/react-native@~7.11.0`,
  `eslint-config-expo@~56.0.4`, `jest-expo@~56.0.4`).
- `react-native-worklets` upgraded to `0.8.3` (the Expo-pinned version
  for Reanimated 4.3.x on SDK 56).
- `typescript` left at `5.9.2` (Expo recommended 6.0.3 but the
  workspace's other packages and ESLint pipelines are not ready for TS
  6; deferred as a follow-up).
- Root `package.json`: `expo` bumped to `~56.0.0`, `react` to `19.2.3`,
  `react-native` to `0.85.3`, `react-native-worklets` to `^0.8.3`; the
  stale `overrides.react-native-worklets: 0.5.1` override deleted (it
  was forcing the duplicate-tree problem).

### Consequences

- ✅ **Good:** `@privy-io/expo@0.67.1` can install cleanly; Phase 4
  Tasks 4a.2 and 4a.3 can proceed.
- ✅ **Good:** Single resolved `react-native` tree across the workspace;
  TypeScript no longer sees two incompatible `StyleSheet`/`ViewStyle`
  identities.
- ✅ **Good:** Spike findings (signing, session expiry, ATA creation)
  transfer to mobile because the SDK generation matches the spike.
- ✅ **Good:** Mobile `npx tsc --noEmit` error count unchanged at 15;
  same files as the pre-upgrade baseline; no new TS regressions.
- ⚠️ **Bad:** RN 0.85 removed `StyleSheet.absoluteFillObject` (replaced
  by `StyleSheet.absoluteFill`); 3 files needed updates (`faceid.tsx`,
  `ActionMenu.tsx`, `InAppBrowser.tsx`).
- ⚠️ **Bad:** `expo-clipboard@~56.0.3` removed the synchronous
  `setString`; replaced with the async `setStringAsync` in
  `WalletQRCode.tsx`.
- ⚠️ **Bad:** RN 0.85 narrowed the `setInterval` return type; one hook
  (`useResendTimer.ts`) needed a `ReturnType<typeof setInterval>` typed
  variable instead of `number`.
- ⚠️ **Bad:** `useColorScheme()` return type narrowed
  (`ColorSchemeName` now strictly `'light' | 'dark' | null | undefined`,
  not arbitrary strings); `constants/Colors.ts` needed explicit
  narrowing.
- ⚠️ **Bad:** `@expo/vector-icons` ships stricter `MaterialIcons` name
  types in this generation; `components/ui/atoms/IconSymbol.tsx`
  switched its `MAPPING` table to a permissive `Record<string, ...>`
  shape to keep the mapping flexible without resolving every SF/Material
  pair.
- ⚠️ **Bad:** `expo-router 6.x` BottomTabBar props no longer line up
  structurally with `@react-navigation/bottom-tabs 7.x`
  `BottomTabBarProps`; `app/(tabs)/_layout.tsx` casts via `unknown` at
  the boundary. Cosmetic — runtime data is identical.
- ⚠️ **Bad:** `npx expo prebuild --clean` was **not** run as part of
  this dispatch because it would prompt interactively. The user must
  run it once locally before the first device build under SDK 56 so the
  native iOS / Android projects regenerate against the new
  `expo-modules-core` shape.
- ⚠️ **Bad:** `typescript` peer-dep mismatch left in place
  (project on 5.9.2, Expo suggests 6.0.3). Flagged as a follow-up
  cleanup; TS 6 has its own breaking changes the migration does not
  need to absorb in the same pass.

## Pros and Cons of the Options

### Upgrade Expo to 56 + align workspace root

- ✅ Spike-validated SDK; lowest-risk SDK choice for Privy.
- ✅ Fixes the workspace duplicate-RN-tree problem in the same commit.
- ✅ Only RN/Expo SDK-level breakages to fix; all in non-business-logic
  files (icons, color hook, clipboard, absolute-fill).
- ❌ Forces a one-shot cascade of peer-dep updates (~30 packages
  bumped).

### Stay on Expo 54, downgrade Privy

- ✅ No app-side churn.
- ❌ Throws away the Phase 1 spike (different SDK generation, different
  hook surface).
- ❌ Privy's older 0.6x.y lines do not all expose
  `useEmbeddedSolanaWallet`; would need additional shim code.

### Jump to Expo 57

- ✅ Latest SDK.
- ❌ Neither the spike nor Privy compatibility matrices have validated
  it; introduces unknown native-build risk into the same commit as the
  Privy install.

## More Information

- Plan: `.claude/plans/xend-grid-migration/phases/phase-4-mobile-cutover/PLAN.md`
- Privy SDK pin: `.claude/plans/xend-grid-migration/phases/phase-1-backend-wallet-plumbing/VERIFIED-executor-1.md` → "Privy SDK Decisions" table
- Spike harness: `spike/privy-solana/` (branch `spike-privy-solana` @ `3d4538c`) — pinned `expo@~56.0.8`, `@privy-io/expo@0.67.1`, `@privy-io/expo-native-extensions@0.0.11`
- Spike package manifest: `spike/privy-solana/package.json`
- Related ADR: `0010-no-load-bearing-provider.md`
- Files touched in this commit: `apps/mobile/package.json`, `package.json` (workspace root), `package-lock.json`, plus the 8 small TS adjustments listed above.
