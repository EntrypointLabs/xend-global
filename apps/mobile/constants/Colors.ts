import { PALETTE, type ColorMode } from "@/constants/palette";

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

const legacy = (mode: ColorMode) => {
  const p = PALETTE[mode];
  return {
    text: p.foreground,
    background: p.background,
    backgroundColored: "#000",
    textOnColored: "#fff",
    primaryButtonInverted: "#000",
    textPrimaryInverted: "#000",
    secondaryButtonInverted: "#383d41",
    textSecondaryInverted: "#fff",
    primary: p.primary,
    primaryLight: "#e3e3e3",
    border: p.border,
    card: p.card,
    notification: p.primary,
    tint: p.tint,
    icon: p.icon,
    tabIconDefault: p.tabIconDefault,
    tabIconSelected: p.tabIconSelected,
    error: p.destructive,
  };
};

/** The older key names, still read through `useThemeColor`. */
export const Colors = { light: legacy("light"), dark: legacy("dark") };
