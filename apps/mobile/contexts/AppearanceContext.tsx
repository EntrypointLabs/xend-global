import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colorScheme } from "nativewind";
import { systemColorScheme } from "react-native-css-interop/dist/runtime/native/appearance-observables";

import { applyAppIcon } from "@/utils/appIcon";

/**
 * `monochrome` is the white app. `colorful` puts the tab roots on the
 * prydd.co photo backdrops with glass surfaces.
 */
export type AppTheme = "monochrome" | "colorful";
export type AppIconChoice = "black" | "white";
/** Light or dark, or whichever the phone is in. Independent of `AppTheme`. */
export type AppMode = "system" | "light" | "dark";

export const THEME_LABELS: Record<AppTheme, string> = {
  monochrome: "Monochrome",
  colorful: "Colorful",
};

export const MODE_LABELS: Record<AppMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export interface Appearance {
  theme: AppTheme;
  icon: AppIconChoice;
  mode: AppMode;
}

const DEFAULT_APPEARANCE: Appearance = {
  theme: "monochrome",
  icon: "black",
  mode: "system",
};

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
      mode:
        value.mode === "light" || value.mode === "dark" ? value.mode : "system",
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/**
 * Puts the app in `mode`, on the phone and in what the app draws from.
 *
 * `colorScheme.set` only tells the phone. The app draws from nativewind's own
 * copy of the answer, which it refreshes when the phone reports a change, and
 * it ignores that report unless the app is in the foreground. At a cold start
 * the app is not there yet, and a Face ID prompt keeps it out, so somebody
 * who chose Light on a dark phone got the dark app until the prompt was
 * answered. The copy is set here as well, so the choice holds from the first
 * frame.
 *
 * System is left to nativewind: the phone has not let go of the old mode by
 * the time this returns, and its report of the change arrives while the app
 * is in the foreground, because a setting was just tapped.
 */
function applyMode(mode: AppMode) {
  colorScheme.set(mode);
  if (mode !== "system") systemColorScheme.set(mode);
}

let stored: Promise<Appearance> | undefined;

/**
 * Reads the saved appearance once and puts the app in its mode. The root
 * layout waits on this before the first screen, so somebody who chose Dark on
 * a light phone never sees the light app first.
 */
export function loadAppearance(): Promise<Appearance> {
  stored ??= AsyncStorage.getItem(STORAGE_KEY)
    .then(parse)
    .catch(() => DEFAULT_APPEARANCE)
    .then((appearance) => {
      applyMode(appearance.mode);
      return appearance;
    });
  return stored;
}

interface AppearanceContextValue extends Appearance {
  setTheme: (theme: AppTheme) => void;
  setIcon: (icon: AppIconChoice) => Promise<void>;
  setMode: (mode: AppMode) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    loadAppearance().then(setAppearance);
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

  const setMode = useCallback(
    (mode: AppMode) => {
      applyMode(mode);
      save({ ...appearance, mode });
    },
    [appearance, save]
  );

  // Theme selection is switched off for now, so every device shows the
  // monochrome app whatever it had picked before. To bring it back, drop the
  // `theme` override here and restore the Theme row in settings/appearance.
  const value = useMemo(
    () => ({
      ...appearance,
      theme: "monochrome" as AppTheme,
      setTheme,
      setIcon,
      setMode,
    }),
    [appearance, setTheme, setIcon, setMode]
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
