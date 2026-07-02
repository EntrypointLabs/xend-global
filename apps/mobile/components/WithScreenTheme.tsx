import React, { useEffect } from "react";
import {
  ScreenThemeProvider,
  useScreenTheme,
} from "@/contexts/ScreenThemeContext";

interface ThemeOptions {
  backgroundColor?: string;
  textColor?: string;
  primaryColor?: string;
}

export function WithScreenTheme<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  themeOptions?: ThemeOptions
) {
  function ComponentWithTheme(props: P) {
    const { setScreenTheme, resetScreenTheme } = useScreenTheme();

    useEffect(() => {
      if (themeOptions) {
        setScreenTheme(themeOptions);
      }

      return () => resetScreenTheme();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <WrappedComponent {...props} />;
  }

  return function WithScreenThemeProvider(props: P) {
    return (
      <ScreenThemeProvider>
        <ComponentWithTheme {...props} />
      </ScreenThemeProvider>
    );
  };
}
