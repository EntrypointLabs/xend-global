import React from "react";
import { ScreenThemeProvider } from "@/contexts/ScreenThemeContext";

interface ThemeOptions {
  backgroundColor?: string;
  textColor?: string;
  primaryColor?: string;
}

/**
 * Mounts a screen-scoped theme so children read the right colors on first paint.
 * The provider itself holds the values — no post-mount effect dance.
 */
export function WithScreenTheme<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  themeOptions?: ThemeOptions
) {
  return function WithScreenThemeProvider(props: P) {
    return (
      <ScreenThemeProvider initialTheme={themeOptions}>
        <WrappedComponent {...props} />
      </ScreenThemeProvider>
    );
  };
}
