import {
  setAlternateAppIcon,
  supportsAlternateIcons,
} from "expo-alternate-app-icons";

import type { AppIconChoice } from "@/contexts/AppearanceContext";

/**
 * Switches the home-screen icon. Black is the app's primary icon, so choosing
 * it resets to the default rather than naming an alternate.
 */
export async function applyAppIcon(choice: AppIconChoice): Promise<void> {
  if (!supportsAlternateIcons) {
    throw new Error("This device can't change the app icon");
  }
  await setAlternateAppIcon(choice === "white" ? "White" : null);
}
