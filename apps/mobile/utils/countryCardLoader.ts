import {
  CARDS_ORIGIN,
  CARDS_PATH,
  CardManifestSchema,
  CountryCardSchema,
  GeoSchema,
  resolveCountryCard,
  type CountryCard,
} from "@/utils/countryCards";

const STORED_CARD = "home.countryCard";
const REQUEST_TIMEOUT_MS = 6_000;

/** Lets a tester preview another country's card, e.g. "NG". */
const COUNTRY_OVERRIDE = process.env.EXPO_PUBLIC_COUNTRY_OVERRIDE;

export interface CardStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** The card this person should see, fetched fresh and remembered. */
export async function fetchCountryCard(
  store: CardStore
): Promise<CountryCard | null> {
  const geoUrl = COUNTRY_OVERRIDE
    ? `${CARDS_ORIGIN}/api/geo?country=${encodeURIComponent(COUNTRY_OVERRIDE)}`
    : `${CARDS_ORIGIN}/api/geo`;
  const [geo, manifest] = await Promise.all([
    getJson(geoUrl).then((body) => GeoSchema.parse(body)),
    getJson(`${CARDS_ORIGIN}${CARDS_PATH}manifest.json`).then((body) =>
      CardManifestSchema.parse(body)
    ),
  ]);
  const card = resolveCountryCard(geo, manifest);
  await store.setItem(STORED_CARD, JSON.stringify(card)).catch(() => undefined);
  return card;
}

/** The last card fetched on this phone, so Home can show it before the network answers. */
export async function storedCountryCard(
  store: CardStore
): Promise<CountryCard | null> {
  try {
    const raw = await store.getItem(STORED_CARD);
    if (!raw) return null;
    const parsed = CountryCardSchema.nullable().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
