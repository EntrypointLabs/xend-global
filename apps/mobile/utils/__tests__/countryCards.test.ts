import {
  resolveCountryCard,
  titleLines,
  type CardManifest,
  type Geo,
} from "@/utils/countryCards";

const manifest: CardManifest = {
  generic: { photo: "photos/world.jpg" },
  countries: {
    GB: {
      lines: ["UNITED", "KINGDOM"],
      photo: "photos/gb.jpg",
      flag: "flags/gb.png",
      titleWidths: [163.5, 232],
    },
    KE: { lines: ["KENYA"], photo: "photos/ke.jpg", symbol: "KSh" },
  },
};

const geo = (country: string | null, extra: Partial<Geo> = {}): Geo => ({
  country,
  name: null,
  currency: null,
  symbol: null,
  ...extra,
});

describe("resolveCountryCard", () => {
  it("uses a country's own card when the manifest has one", () => {
    const card = resolveCountryCard(
      geo("GB", { name: "United Kingdom", currency: "GBP", symbol: "£" }),
      manifest
    );
    expect(card).toMatchObject({
      country: "GB",
      lines: ["UNITED", "KINGDOM"],
      currency: "GBP",
      symbol: "£",
      titleWidths: [163.5, 232],
    });
    expect(card?.photoUrl).toMatch(/\/cards\/v1\/photos\/gb\.jpg$/);
    expect(card?.flagUrl).toMatch(/\/cards\/v1\/flags\/gb\.png$/);
  });

  it("lets the manifest override the geo symbol", () => {
    const card = resolveCountryCard(
      geo("KE", { name: "Kenya", currency: "KES", symbol: "KES" }),
      manifest
    );
    expect(card?.symbol).toBe("KSh");
  });

  it("falls back to the generic card for a country without one", () => {
    const card = resolveCountryCard(
      geo("BR", { name: "Brazil", currency: "BRL", symbol: "R$" }),
      manifest
    );
    expect(card).toMatchObject({
      country: "BR",
      name: "Brazil",
      lines: ["BRAZIL"],
      currency: "BRL",
      symbol: "R$",
      flagUrl: null,
    });
    expect(card?.photoUrl).toMatch(/\/cards\/v1\/photos\/world\.jpg$/);
  });

  it("shows no card when the country is unknown", () => {
    expect(resolveCountryCard(geo(null), manifest)).toBeNull();
  });
});

describe("titleLines", () => {
  it("keeps one word on one line", () => {
    expect(titleLines("Japan")).toEqual(["JAPAN"]);
  });

  it("splits longer names into two even lines", () => {
    expect(titleLines("United Arab Emirates")).toEqual([
      "UNITED ARAB",
      "EMIRATES",
    ]);
    expect(titleLines("Bosnia and Herzegovina")).toEqual([
      "BOSNIA AND",
      "HERZEGOVINA",
    ]);
  });
});
