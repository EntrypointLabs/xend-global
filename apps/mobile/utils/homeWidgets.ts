export const HOME_WIDGETS = [
  {
    key: "assets",
    title: "Your assets",
    detail: "Holdings and what to do next",
  },
  {
    key: "transactions",
    title: "Recent transactions",
    detail: "Your latest money in and out",
  },
  {
    key: "spend",
    title: "Spent this month",
    detail: "What you have sent so far",
  },
  { key: "watchlist", title: "Watchlist", detail: "Prices for popular tokens" },
] as const;

export type HomeWidgetKey = (typeof HOME_WIDGETS)[number]["key"];
export type HomeWidgetVisibility = Record<HomeWidgetKey, boolean>;

export const DEFAULT_WIDGET_VISIBILITY: HomeWidgetVisibility = {
  assets: true,
  transactions: true,
  spend: true,
  watchlist: true,
};

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
