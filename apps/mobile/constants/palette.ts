/**
 * The semantic tokens as plain colour strings, for the places a class cannot
 * reach: icon `color` props, SVG fills, native navigator and sheet backgrounds.
 *
 * `global.css` owns the values. This is a mirror of it, and
 * `__tests__/palette.test.ts` fails when the two disagree.
 */
export type ColorMode = "light" | "dark";

export interface Palette {
  background: string;
  foreground: string;
  ink: string;
  card: string;
  muted: string;
  primary: string;
  primaryForeground: string;
  tint: string;
  icon: string;
  tabIconDefault: string;
  tabIconSelected: string;
  border: string;
  success: string;
  destructive: string;
  /** Take care, as opposed to `destructive`'s something is wrong. */
  warning: string;
  info: string;
}

export const PALETTE: Record<ColorMode, Palette> = {
  light: {
    background: "#FFFFFF",
    foreground: "#000000",
    ink: "#0E0F0C",
    card: "#FFFFFF",
    muted: "#F2F2F0",
    primary: "#000000",
    primaryForeground: "#FFFFFF",
    tint: "#0A7FA3",
    icon: "#000000",
    tabIconDefault: "#687078",
    tabIconSelected: "#0A7FA3",
    border: "#CCCCCC",
    success: "#33C758",
    destructive: "#FF3C2E",
    warning: "#F0A800",
    info: "#007BFF",
  },
  dark: {
    background: "#0E0F0C",
    foreground: "#F1F1EE",
    ink: "#F1F1EE",
    card: "#1A1B18",
    muted: "#22231F",
    primary: "#FFFFFF",
    primaryForeground: "#0E0F0C",
    tint: "#FFFFFF",
    icon: "#FFFFFF",
    tabIconDefault: "#9CA1A5",
    tabIconSelected: "#FFFFFF",
    border: "#333333",
    success: "#57DB78",
    destructive: "#FF675C",
    warning: "#FFC53D",
    info: "#3D9BFF",
  },
};

/** `hex` at `alpha`, as the `rgba()` string React Native colour props take. */
export function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
