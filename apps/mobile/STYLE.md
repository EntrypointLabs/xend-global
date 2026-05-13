# Mobile Styling Guide

> One source of truth for how to style `apps/mobile`. See [`docs/adr/0001`](../../docs/adr/0001-consolidate-on-nativewind-styling.md) for the umbrella decision.

## Rules

1. **All styling uses NativeWind `className`.** No `StyleSheet.create`, no raw `style={{...}}`.
2. **Tokens come from Tailwind config**, sourced from CSS variables in [`global.css`](./global.css). Don't write hardcoded hex colors.
3. **Dark mode is class-driven** ([`darkMode: "class"`](./tailwind.config.js)). `dark:` variants apply automatically when an ancestor has the `dark` class.
4. **Conditional classes go through `cn()`** from [`@/utils/cn`](./utils/cn.ts).
5. **Pre-existing call sites** that use `useThemeColor`, `StyleSheet.create`, or inline `style={{}}` are being migrated; new code must follow the rules above.

## Quick reference

```tsx
// ✅ Good
<View className="bg-background flex-1 px-4">
  <Text className={cn("text-foreground", isError && "text-destructive")}>
    Hello
  </Text>
</View>;

// ❌ Bad
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
});
<View style={[styles.container, { padding: 16 }]}>
  <Text style={{ color: useThemeColor({}, "text") }}>Hello</Text>
</View>;
```

## Inline `style` exceptions

Five exception markers let you opt out of the `no-restricted-syntax` lint when an inline `style` is genuinely required. See [`docs/adr/0004`](../../docs/adr/0004-inline-style-exceptions.md).

| Marker                 | When to use                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `REANIMATED-EXCEPTION` | `style={useAnimatedStyle(...)}` — worklets can't read NativeWind classes |
| `MEASURED-LAYOUT`      | Dimensions from `onLayout` / `measure()`                                 |
| `DYNAMIC-COLOR`        | Backend-driven colors — Tailwind JIT can't see runtime strings           |
| `PLATFORM-SHADOW`      | Shadow / elevation where iOS+Android parity diverges from `shadow-*`     |
| `GESTURE-DRIVEN`       | Transforms written by `react-native-gesture-handler` / `Animated.event`  |

Disable the lint rule per line and append the marker as the disable comment:

```tsx
// eslint-disable-next-line no-restricted-syntax -- REANIMATED-EXCEPTION
<Animated.View style={animatedStyle}>...</Animated.View>
```

## Adding a new token

1. Add the HSL triplet to both `:root` and `.dark` blocks in [`global.css`](./global.css).
2. Add the entry to `theme.extend.colors` in [`tailwind.config.js`](./tailwind.config.js) using `hsl(var(--your-token) / <alpha-value>)`.
3. Use it: `<View className="bg-your-token">` or with opacity: `<View className="bg-your-token/20">`.

## Theme access in JS

Use `useTheme()` from [`@/hooks/useTheme`](./hooks/useTheme.ts) when you need to read or set the theme programmatically (e.g. flipping the canvas, conditional logic). Do **not** use the React Native core `useColorScheme` for class-strategy theming — it bypasses the manual override path.

```tsx
import { useTheme } from "@/hooks/useTheme";
const { theme, setTheme, toggleTheme } = useTheme();
```

## Components

- **Text:** prefer `Typography` from [`@/components/ui/atoms/Typography`](./components/ui/atoms/Typography.tsx). `ThemedText` is being phased out (see [ADR-0005](../../docs/adr/0005-typography-canonical-text-api.md)).
- **Pressables:** use `Pressable` with the render-prop pattern for pressed states; pre-compute classNames with `cn()` outside JSX when used inside Navigation context (see PITFALL C5).
- **Modals / animated views:** apply static classes to the outer non-animated `View`; keep `useAnimatedStyle` style on the inner `Animated.View`.

## Lint enforcement

The lint rule is `error` for files under `app/`, `components/`, `contexts/`, `hooks/`, `utils/`. CI will fail if a `StyleSheet.create`, raw `style={{}}`, or `useThemeColor` import is added. Unreachable / deferred files are not in scope — see [ADR-0006](../../docs/adr/0006-lint-enforcement-policy.md) and `DEAD-CODE.md` (when generated).
