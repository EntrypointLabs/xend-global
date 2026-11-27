/**
 * Screen names come from route patterns, not concrete paths, so a token mint,
 * payment reference or order id in the URL never reaches analytics and every
 * instance of a screen groups under one name.
 *
 * Accepts expo-router segments (`["(tabs)", "settings", "index"]`) or a path
 * whose dynamic parts are replaced by the matching `params` keys.
 */
export function routeToScreenName(
  route: readonly string[] | string,
  params: Record<string, unknown> = {},
): string {
  let parts: string[];
  if (typeof route === "string") {
    const dynamic = new Map<string, string>();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value) dynamic.set(value, `[${key}]`);
    }
    parts = route.split("/").map((p) => dynamic.get(p) ?? p);
  } else {
    parts = [...route];
  }
  const name = parts
    .filter((p) => p && !/^\(.*\)$/.test(p) && p !== "index")
    .join("/");
  return name ? `/${name}` : "/";
}
