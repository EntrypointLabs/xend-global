import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { applyAppIcon } from "@/utils/appIcon";

/**
 * `monochrome` is the white app. `colorful` puts the tab roots on the
 * prydd.co photo backdrops with glass surfaces.
 */
export type AppTheme = "monochrome" | "colorful";
export type AppIconChoice = "black" | "white";

export const THEME_LABELS: Record<AppTheme, string> = {
  monochrome: "Monochrome",
  colorful: "Colorful",
};

export interface Appearance {
  theme: AppTheme;
  icon: AppIconChoice;
}

const DEFAULT_APPEARANCE: Appearance = { theme: "monochrome", icon: "black" };

// Device-wide, not per user: it is how this phone looks, and the app icon
// belongs to the device anyway. Not secret, so AsyncStorage over the keychain.
const STORAGE_KEY = "appearance.v1";

function parse(raw: string | null): Appearance {
  if (!raw) return DEFAULT_APPEARANCE;
  try {
    const value = JSON.parse(raw) as Partial<Appearance>;
    return {
      theme: value.theme === "colorful" ? "colorful" : "monochrome",
      icon: value.icon === "white" ? "white" : "black",
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

interface AppearanceContextValue extends Appearance {
  setTheme: (theme: AppTheme) => void;
  setIcon: (icon: AppIconChoice) => Promise<void>;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => setAppearance(parse(raw)))
      .catch(() => {});
  }, []);

  const save = useCallback((next: Appearance) => {
    setAppearance(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const setTheme = useCallback(
    (theme: AppTheme) => save({ ...appearance, theme }),
    [appearance, save]
  );

  // The icon is switched first and only recorded once the system accepted it,
  // so the setting can never claim an icon the home screen is not showing.
  const setIcon = useCallback(
    async (icon: AppIconChoice) => {
      await applyAppIcon(icon);
      save({ ...appearance, icon });
    },
    [appearance, save]
  );

  const value = useMemo(
    () => ({ ...appearance, setTheme, setIcon }),
    [appearance, setTheme, setIcon]
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error("useAppearance must be used inside AppearanceProvider");
  }
  return value;
}

/** True when the tab roots should sit on the photo backdrops. */
export function useColorfulTheme(): boolean {
  return useAppearance().theme === "colorful";
}
