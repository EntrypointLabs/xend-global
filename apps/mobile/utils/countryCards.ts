import { z } from "zod";

/** Where the country card photos, flags and manifest are served from. */
export const CARDS_ORIGIN =
  process.env.EXPO_PUBLIC_CARDS_ORIGIN ?? "https://prydd.co";
export const CARDS_PATH = "/cards/v1/";

/** The caller's country, as prydd.co's edge reads it from their IP. */
export const GeoSchema = z.object({
  country: z.string().length(2).nullable(),
  name: z.string().nullable(),
  currency: z.string().length(3).nullable(),
  symbol: z.string().nullable(),
});
export type Geo = z.infer<typeof GeoSchema>;

const CountryEntrySchema = z.object({
  /** The title as it is set on the card, one string per line. */
  lines: z.array(z.string()).min(1).max(2),
  photo: z.string(),
  flag: z.string().optional(),
  /** Overrides for what the geo answer says, e.g. "KSh" over "KES". */
  name: z.string().optional(),
  currency: z.string().length(3).optional(),
  symbol: z.string().optional(),
  /** Width of each title line on the 436pt-wide card. */
  titleWidths: z.array(z.number().positive()).optional(),
});

export const CardManifestSchema = z.object({
  generic: z.object({ photo: z.string() }),
  countries: z.record(z.string(), CountryEntrySchema),
});
export type CardManifest = z.infer<typeof CardManifestSchema>;

export interface CountryCard {
  country: string;
  name: string;
  lines: string[];
  currency: string | null;
  symbol: string | null;
  photoUrl: string;
  /** Null on the generic card for a country without a flag of its own. */
  flagUrl: string | null;
  titleWidths?: number[];
}

function assetUrl(path: string): string {
  return /^https?:\/\//.test(path)
    ? path
    : `${CARDS_ORIGIN}${CARDS_PATH}${path}`;
}

/**
 * A country name set as the card title: upper case, split into two lines of
 * roughly even length when it has more than one word.
 */
export function titleLines(name: string): string[] {
  const words = name.toUpperCase().trim().split(/\s+/);
  if (words.length < 2) return words;
  let best: string[] = [name.toUpperCase()];
  let bestGap = Infinity;
  for (let i = 1; i < words.length; i++) {
    const first = words.slice(0, i).join(" ");
    const second = words.slice(i).join(" ");
    const gap = Math.abs(first.length - second.length);
    if (gap < bestGap) {
      best = [first, second];
      bestGap = gap;
    }
  }
  return best;
}

/**
 * The card a person in `geo.country` sees: that country's own when the
 * manifest has one, otherwise the generic card with their country's name and
 * currency. Null when the country is unknown.
 */
export function resolveCountryCard(
  geo: Geo,
  manifest: CardManifest
): CountryCard | null {
  if (!geo.country) return null;
  const entry = manifest.countries[geo.country];
  const name = entry?.name ?? geo.name ?? geo.country;
  return {
    country: geo.country,
    name,
    lines: entry?.lines ?? titleLines(name),
    currency: entry?.currency ?? geo.currency,
    symbol: entry?.symbol ?? geo.symbol,
    photoUrl: assetUrl(entry?.photo ?? manifest.generic.photo),
    flagUrl: entry?.flag ? assetUrl(entry.flag) : null,
    titleWidths: entry?.titleWidths,
  };
}

export const CountryCardSchema: z.ZodType<CountryCard> = z.object({
  country: z.string(),
  name: z.string(),
  lines: z.array(z.string()),
  currency: z.string().nullable(),
  symbol: z.string().nullable(),
  photoUrl: z.string(),
  flagUrl: z.string().nullable(),
  titleWidths: z.array(z.number()).optional(),
});
