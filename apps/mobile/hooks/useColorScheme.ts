import { useTheme } from "@/hooks/useTheme";

export function useColorScheme(): "light" | "dark" {
  return useTheme().theme;
}
