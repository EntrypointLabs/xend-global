# Dead Code Inventory

> Manual reachability sweep performed during the style-cleanup refactor.
> See [docs/adr/0008](../../docs/adr/0008-style-cleanup-dependency-policy.md) for why we chose `rg` over `knip`.

Method: starting from `app/_layout.tsx`, all `app/**/_layout.tsx`, and `app/**/*+api.ts` entry points, traced imports via `rg -l "from .*<basename>"` on each file. Anything with no inbound import from the entry graph is flagged below. Items in this list are **candidates** for removal — verify each before deleting (some may be referenced via dynamic imports or by tests).

## Suspected dead — review before deletion

| File                                                                  | Reason flagged                                                                                                                                                                                                                                                                                                                                                                      | Recommended action                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `components/ScreenLoginForm.tsx`                                      | No inbound imports found. `LoginForm.tsx` is the consumed variant (used by `(auth)/restore-account.tsx`).                                                                                                                                                                                                                                                                           | Delete after manual verification.                                                |
| `components/LoginForm.tsx`                                            | Imported only by `(auth)/restore-account.tsx`, which is itself behind a route that doesn't appear in `app/_layout.tsx`'s navigation tree (no `<Stack.Screen name="restore-account">`). Status uncertain — could be reachable via deep link.                                                                                                                                         | Verify route reachability.                                                       |
| `app/(auth)/faceid.tsx`                                               | File comment marks `/** NOT USED */`. No route entry registered.                                                                                                                                                                                                                                                                                                                    | Delete after verifying no deep link consumers.                                   |
| `utils/mockDatabase.ts`                                               | Pattern-matched as legacy from `MockDatabase` references in `AuthContext.tsx` — that import survives but the file may be partially used.                                                                                                                                                                                                                                            | Audit which methods are actually called.                                         |
| `utils/easClient.ts`                                                  | Imported by `AuthContext`, `(send)/confirm.tsx`, `(send)/fiatconfirm.tsx`, `(modals)/bankdetails.tsx`, `app/_layout.tsx`, `hooks/useKyc.ts`, `hooks/useVirtualAccount.ts`, `hooks/useWalletData.ts`, `utils/auth.ts`, `utils/smartAccount.ts`, `contexts/ModalFlowContext.tsx` — **actively used**, NOT dead. Kept here as a navigation aid because it is widely cited in research. |
| `components/ui/atoms/HapticTab.tsx`                                   | Not imported anywhere I could find.                                                                                                                                                                                                                                                                                                                                                 | Delete after verification.                                                       |
| `components/ui/atoms/icons/*` (some subset)                           | Some icon SVG components may be unused. Run `for f in apps/mobile/components/ui/atoms/icons/*; do echo $f; rg -l "$(basename $f .tsx)" apps/mobile --include="*.tsx" \| grep -v "$f" \| head -1; done` to enumerate.                                                                                                                                                                | Per-file audit.                                                                  |
| `app/api/*+api.ts` files invoked only by deprecated `EasClient` paths | Those routes are Expo Router server routes; many are still called by mobile, but the dual-client pattern (`BackendClient` vs `EasClient`, per `.claude/context/ARCHITECTURE.md`) means some `+api.ts` files may be unreachable.                                                                                                                                                     | Audit each by grepping for `easClient.<method>` versus `backendClient.<method>`. |

## Deferred from refactor (NOT dead, but flagged as deferred work)

These files survive intentionally — they are still consumed but their removal is deferred per architectural decisions:

| File                                              | Why it stays                                                                                                                                                                                                                                                            | Tracked in                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `hooks/useThemeColor.ts`                          | Still consumed by 9 reachable files (`SavedAccounts`, `Keypad`, `CircleButton`, `InAppBrowser`, `ActionModal`, `(send)/_layout.tsx`, `(send)/confirm.tsx`, `(send)/fiatamount.tsx`, `(send)/fiatconfirm.tsx`). Removal blocked on converting each to NativeWind tokens. | ADR-0001 deferred follow-up                                          |
| `contexts/ScreenThemeContext.tsx`                 | Per-screen forced theme; still consumed by 17 auth/modal screens. Deletion scoped to a follow-up PR.                                                                                                                                                                    | [ADR-0007](../../docs/adr/0007-defer-screentheme-context-removal.md) |
| `components/WithScreenTheme.tsx`                  | HOC powering `ScreenThemeContext`. Deferred with it.                                                                                                                                                                                                                    | ADR-0007                                                             |
| `constants/Theme.ts`                              | Consumed by `ScreenThemeContext` and `app/_layout.tsx`'s `@react-navigation/native` `ThemeProvider`. Stays.                                                                                                                                                             | —                                                                    |
| `constants/Spacing.ts`, `constants/Typography.ts` | Numeric re-exports for the few inline-style exceptions that need raw numbers (e.g. measured layout). Stays.                                                                                                                                                             | ADR-0001                                                             |
| `utils/class.ts`                                  | Deprecated re-export shim of `utils/cn.ts`. Will be removed after one release cycle.                                                                                                                                                                                    | Manual follow-up                                                     |
| `components/ui/atoms/ThemedText.tsx`              | Internally uses `Typography`; kept for compatibility with the legacy `type="title"` enum used by many call sites. Eventual migration tracked in [ADR-0005](../../docs/adr/0005-typography-canonical-text-api.md).                                                       | ADR-0005                                                             |

## Verification commands

```bash
# Find files with no inbound imports at all:
for f in $(find apps/mobile/components apps/mobile/utils apps/mobile/hooks -name "*.tsx" -o -name "*.ts"); do
  base=$(basename "$f" | sed 's/\.[^.]*$//')
  count=$(rg -l "from .*$base[\"']" apps/mobile --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "$f" | wc -l)
  if [ "$count" = "0" ]; then echo "$f"; fi
done

# Find React components never used in JSX:
for c in $(grep -rE "^export (default )?(function|const) [A-Z]" apps/mobile/components --include="*.tsx" | sed -E 's/.*(function|const) ([A-Z][A-Za-z0-9]+).*/\2/' | sort -u); do
  count=$(rg -l "<$c[ />]" apps/mobile --include="*.tsx" 2>/dev/null | wc -l)
  if [ "$count" = "0" ]; then echo "$c"; fi
done
```

## Action items

1. Run the verification commands above and confirm each "Suspected dead" entry.
2. Open a follow-up PR titled `chore(mobile): remove unused files surfaced during style-cleanup` that deletes only confirmed entries.
3. Track the deferred work (useThemeColor removal, ScreenThemeContext removal) under their respective ADRs.
