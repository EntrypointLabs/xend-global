import { useMemo } from "react";

import { PALETTE, withAlpha, type Palette } from "@/constants/palette";
import { useTheme } from "@/hooks/useTheme";

export interface ThemedPalette extends Palette {
  dark: boolean;
  /** The foreground at `alpha`: the value behind a `text-foreground/40` class. */
  fg: (alpha: number) => string;
}

/**
 * The current mode's tokens as colour strings. Reach for a class first; this
 * is for props that only take a colour, such as an icon's `color`.
 */
export function usePalette(): ThemedPalette {
  const { theme } = useTheme();
  return useMemo(() => {
    const palette = PALETTE[theme];
    return {
      ...palette,
      dark: theme === "dark",
      fg: (alpha: number) => withAlpha(palette.foreground, alpha),
    };
  }, [theme]);
}
