# Mobile Styling Guide

> One source of truth for how to style `apps/mobile`. For what things should look like (type scale, primitives, screen patterns) see the [design system](../../docs/design/design-system.md). See [`docs/adr/0001`](../../docs/adr/0001-consolidate-on-nativewind-styling.md) for the umbrella decision.

## Rules

1. **All styling uses NativeWind `className`.** No `StyleSheet.create`, no raw `style={{...}}`.
2. **Tokens come from Tailwind config**, sourced from CSS variables in [`global.css`](./global.css). Don't write hardcoded hex colors.
3. **Dark mode is class-driven** ([`darkMode: "class"`](./tailwind.config.js)). Tokens and `dark:` variants follow the mode on their own; see [Dark mode](#dark-mode).
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

## Dark mode

The app runs light or dark: the phone's setting by default, or whichever the person picks under Settings > Appearance. Every screen has to read in both. Dark is the light page inverted, so the brand ink (`#0E0F0C`) becomes the canvas and cards lift off it by getting lighter.

A literal black or white is right only when the thing is black or white in **both** modes. Everything else is a token:

| Light-only                                                     | Write instead                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `bg-white` on a page                                           | `bg-background`                                                          |
| `bg-white` on a sheet, modal, card, popover, anything raised   | `bg-card`                                                                |
| `text-black`, `text-black/40`                                  | `text-foreground`, `text-foreground/40` (the alpha carries over)         |
| `text-[#0E0F0C]`, `border-[#0E0F0C]`                           | `text-ink`, `border-ink`                                                 |
| `bg-black/5`, `border-black/10`, `border-black`                | `bg-foreground/5`, `border-foreground/10`, `border-foreground`           |
| `bg-black` or `bg-[#0E0F0C]` as a filled button, badge or dot  | `bg-primary`, and what sits on it `text-primary-foreground`              |
| `border-white` cutting an avatar or badge out of what it is on | `border-background`, or `border-card` when it sits on a raised surface   |
| A grey fill: `bg-[#F0F0F0]`, `bg-[#F7F7F7]`, `bg-gray-100`     | Keep the literal and add `dark:bg-muted`                                 |
| A pastel fill behind an icon: `bg-[#E7F6EC]`                   | Keep the literal and add the icon's own hue at 15%: `dark:bg-success/15` |
| A colour prop: `color="#000"`, `"#0E0F0C"`, `"#00000066"`      | `usePalette()`: `palette.foreground`, `palette.ink`, `palette.fg(0.4)`   |
| `color="#FFF"` for a glyph on a filled button                  | `palette.primaryForeground`                                              |
| `#34C759`, `#FF3B30`, `#F90101`, `#007AFF`                     | `success`, `destructive`, `info`, as a class or from `usePalette()`      |

Light mode does not change when a screen is made to work in dark. Where no token equals the light value exactly, keep the light literal and add a `dark:` variant beside it.

These keep their literal colours, because they are the same in both modes:

- Anything drawn over a photo or the camera: the `GLASS` and photo surface in [`components/ui/glass.tsx`](./components/ui/glass.tsx), the `onPhoto` branch of a component, the QR scanner.
- The sign-in door (`login`, `recover`, `add-email`, `AuthAtmosphere`), the splash, the card pitch, and the theme preview. They are black by design.
- A scrim behind a modal (`bg-black/50`) and every `shadowColor`.
- A QR code and the white plate under it. A scanner needs dark on light.
- Brand marks: merchant, bank and token logos, and the colours that identify a key type or a feature.

Native props do not read classes, so set them from `usePalette()`: `placeholderTextColor`, `ActivityIndicator` and `RefreshControl` colours, a bottom sheet's `backgroundStyle`, a `BlurView`'s `tint` (`palette.dark ? "dark" : "light"`), `keyboardAppearance`, and `<StatusBar style="auto" />` on any screen that follows the mode.

## Theme access in JS

Use `useTheme()` from [`@/hooks/useTheme`](./hooks/useTheme.ts) when you need to read the mode for conditional logic, and `usePalette()` from [`@/hooks/usePalette`](./hooks/usePalette.ts) when you need a token as a colour string. The person's choice is saved through `setMode` in [`AppearanceContext`](./contexts/AppearanceContext.tsx), not by calling `setTheme` directly. Do **not** use the React Native core `useColorScheme` for class-strategy theming: it bypasses the manual override path.

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
