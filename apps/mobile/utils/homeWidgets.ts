/**
 * Country-account widgets on Home. Catalog is country-keyed so more locales
 * can plug in later without another redesign. Only the UK ships for now.
 */
export const HOME_WIDGETS = [
  {
    key: "uk",
    title: "United Kingdom",
    detail: "GBP balance",
    countryCode: "GB",
    currency: "GBP",
    currencySymbol: "£",
    flag: "🇬🇧",
    flagImage: require("@/assets/images/widgets/flag-gb.png"),
    /** Static FX copy for now; live rates later. */
    rateLabel: "£1 = ₦1,898.44",
    displayName: "UNITED KINGDOM",
    /** Wise UK reference plate — photo, type, pill, and dock at 1:1. */
    background: require("@/assets/images/widgets/united-kingdom-plate.png"),
  },
] as const;

export type HomeWidget = (typeof HOME_WIDGETS)[number];
export type HomeWidgetKey = HomeWidget["key"];
export type HomeWidgetVisibility = Record<HomeWidgetKey, boolean>;

export const DEFAULT_WIDGET_VISIBILITY: HomeWidgetVisibility = {
  uk: true,
};

export function widgetByKey(key: HomeWidgetKey): HomeWidget {
  const found = HOME_WIDGETS.find((widget) => widget.key === key);
  if (!found) throw new Error(`Unknown home widget: ${key}`);
  return found;
}

/**
 * Reads what was saved, tolerating anything. A widget the saved value does not
 * mention stays on, so a section added in a later release shows up instead of
 * being hidden by a record that predates it.
 */
export function parseWidgetVisibility(stored: unknown): HomeWidgetVisibility {
  const result = { ...DEFAULT_WIDGET_VISIBILITY };
  if (typeof stored !== "object" || stored === null) return result;
  for (const { key } of HOME_WIDGETS) {
    const value = (stored as Record<string, unknown>)[key];
    if (typeof value === "boolean") result[key] = value;
  }
  return result;
}
