import React, { createContext, useContext, useState, ReactNode } from "react";
import { useThemeColor } from "@/hooks/useThemeColor";
import * as Sentry from "@sentry/react-native";

interface ScreenThemeOverrides {
  backgroundColor?: string;
  textColor?: string;
  primaryColor?: string;
}

interface ScreenThemeContextType {
  backgroundColor: string;
  textColor: string;
  primaryColor: string;
  setScreenTheme: (theme: {
    backgroundColor?: string;
    textColor?: string;
    primaryColor?: string;
  }) => void;
  resetScreenTheme: () => void;
}

const ScreenThemeContext = createContext<ScreenThemeContextType | undefined>(
  undefined
);

export function ScreenThemeProvider({
  children,
  initialTheme,
}: {
  children: ReactNode;
  /** Applied on first paint so themed children do not flash the global default. */
  initialTheme?: {
    backgroundColor?: string;
    textColor?: string;
    primaryColor?: string;
  };
}) {
  const defaultBackground = useThemeColor({}, "background");
  const defaultText = useThemeColor({}, "text");
  const defaultPrimary = useThemeColor({}, "primary");

  // Only what a screen overrode is held. Anything left unset is read from the
  // global theme on each render, so it follows a switch between light and dark.
  const [overrides, setOverrides] = useState<ScreenThemeOverrides>(
    initialTheme ?? {}
  );
  const backgroundColor = overrides.backgroundColor ?? defaultBackground;
  const textColor = overrides.textColor ?? defaultText;
  const primaryColor = overrides.primaryColor ?? defaultPrimary;

  const setScreenTheme = (theme: ScreenThemeOverrides) => {
    setOverrides((current) => ({
      backgroundColor: theme.backgroundColor || current.backgroundColor,
      textColor: theme.textColor || current.textColor,
      primaryColor: theme.primaryColor || current.primaryColor,
    }));
  };

  const resetScreenTheme = () => setOverrides({});

  return (
    <ScreenThemeContext.Provider
      value={{
        backgroundColor,
        textColor,
        primaryColor,
        setScreenTheme,
        resetScreenTheme,
      }}
    >
      {children}
    </ScreenThemeContext.Provider>
  );
}

export function useScreenTheme() {
  const context = useContext(ScreenThemeContext);
  if (context === undefined) {
    Sentry.captureException(
      new Error(
        `useScreenTheme must be used within a ScreenThemeProvider. (contexts)/ScreenThemeContext.tsx (useScreenTheme)`
      )
    );
    throw new Error("useScreenTheme must be used within a ScreenThemeProvider");
  }
  return context;
}
