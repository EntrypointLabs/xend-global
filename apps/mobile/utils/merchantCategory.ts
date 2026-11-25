export const MERCHANT_CATEGORIES = [
  "shopping",
  "food_drink",
  "groceries",
  "transport",
  "travel",
  "entertainment",
  "health",
  "services",
  "bills",
  "other",
] as const;

export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];

export type MerchantMark =
  | { kind: "logo"; uri: string }
  | { kind: "category"; category: MerchantCategory }
  | { kind: "generic" };

/**
 * What to draw for a Merchant: their logo, else the icon for what they sell,
 * else a plain storefront.
 *
 * The logo URL is only a candidate. The backend hands one out before it knows
 * the Merchant has a logo at all, so a failed load has to land on the category
 * rather than on an empty tile.
 */
export function resolveMerchantMark({
  logoUrl,
  category,
  logoFailed,
}: {
  logoUrl?: string | null;
  category?: MerchantCategory | null;
  logoFailed: boolean;
}): MerchantMark {
  const uri = logoUrl?.trim();
  if (uri && !logoFailed) return { kind: "logo", uri };
  if (category) return { kind: "category", category };
  return { kind: "generic" };
}
