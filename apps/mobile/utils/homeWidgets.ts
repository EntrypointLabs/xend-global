/**
 * Sections a Consumer can switch on or off on Home. The country card is one
 * section whose content follows where the person is.
 */
export const HOME_WIDGET_KEYS = ["country"] as const;

export type HomeWidgetKey = (typeof HOME_WIDGET_KEYS)[number];
export type HomeWidgetVisibility = Record<HomeWidgetKey, boolean>;

export const DEFAULT_WIDGET_VISIBILITY: HomeWidgetVisibility = {
  country: true,
};

/**
 * Reads what was saved, tolerating anything. A widget the saved value does not
 * mention stays on, so a section added in a later release shows up instead of
 * being hidden by a record that predates it.
 */
export function parseWidgetVisibility(stored: unknown): HomeWidgetVisibility {
  const result = { ...DEFAULT_WIDGET_VISIBILITY };
  if (typeof stored !== "object" || stored === null) return result;
  for (const key of HOME_WIDGET_KEYS) {
    const value = (stored as Record<string, unknown>)[key];
    if (typeof value === "boolean") result[key] = value;
  }
  return result;
}
