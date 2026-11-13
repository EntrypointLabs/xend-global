import { useColorScheme } from "react-native";

const tintColorLight = "#0a7ea4";
const tintColorDark = "#fff";

/**
 * PRYDD auth door (login / recover / add-email). Dark canvas with Plasma-style
 * lifestyle atmosphere; brand blue is a faint accent only. Primary actions are
 * white pills (black label), matching the Plasma door treatment.
 */
export const AUTH_BRAND_BLUE = "#3256EC";
export const AUTH_CANVAS = "#000000";
export const AUTH_CTA = "#FFFFFF";
export const AUTH_CTA_LABEL = "#000000";

export type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

export const Colors = {
  light: {
    text: "#11181C",
    background: "#fff",
    backgroundColored: "#000",
    textOnColored: "#fff",
    primaryButtonInverted: "#000",
    textPrimaryInverted: "#000",
    secondaryButtonInverted: "#383d41",
    textSecondaryInverted: "#fff",
    primary: "#000",
    primaryLight: "#e3e3e3",
    border: "#ccc",
    card: "#fff",
    notification: "#000",
    tint: tintColorLight,
    icon: "#000",
    tabIconDefault: "#687076",
    tabIconSelected: tintColorLight,
    error: "#FF3B30",
  },
  dark: {
    text: "#ECEDEE",
    background: "#151718",
    backgroundColored: "#000",
    textOnColored: "#fff",
    primaryButtonInverted: "#000",
    textPrimaryInverted: "#000",
    secondaryButtonInverted: "#383d41",
    textSecondaryInverted: "#fff",
    primary: "#fff",
    primaryLight: "#e3e3e3",
    border: "#333",
    card: "#000",
    notification: "#fff",
    tint: tintColorDark,
    icon: "#fff",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: tintColorDark,
    error: "#FF453A",
  },
};

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const scheme = useColorScheme();
  const theme: "light" | "dark" = scheme === "dark" ? "dark" : "light";
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}
