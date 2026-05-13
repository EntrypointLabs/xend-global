// Codebase-conventional alias for nativewind's color-scheme hook.
// Use this everywhere `useColorScheme` from react-native or `@/hooks/useColorScheme`
// was previously used. See docs/adr/0002-darkmode-class-strategy.md.
import { useColorScheme } from "nativewind";

export function useTheme() {
  const { colorScheme, setColorScheme, toggleColorScheme } = useColorScheme();
  return {
    theme: (colorScheme ?? "light") as "light" | "dark",
    setTheme: setColorScheme,
    toggleTheme: toggleColorScheme,
  };
}
