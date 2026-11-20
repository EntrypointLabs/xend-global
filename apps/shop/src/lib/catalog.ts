export type ArtKind =
  | "tee"
  | "hoodie"
  | "cap"
  | "socks"
  | "mat"
  | "tote"
  | "stickers"
  | "mug"
  | "pin"
  | "jacket"
  | "headphones"
  | "bundle"
  | "object";

export type Tone = "ink" | "bone" | "graphite" | "steel";

export interface Product {
  id: string;
  slug: string;
  number: string;
  name: string;
  line: string;
  priceCents: number;
  art: ArtKind;
  tone: Tone;
  sizes: string[] | null;
  stock: number | Record<string, number>;
  description: string;
  details: string[];
  limited?: string;
}

const APPAREL = ["S", "M", "L", "XL"];

export const PRODUCTS: Product[] = [
  {
    id: "tee-ink",
    slug: "passage-tee-ink",
    number: "01",
    name: "Passage Tee",
    line: "Ink",
    priceCents: 3800,
    art: "tee",
    tone: "ink",
    sizes: APPAREL,
    stock: { S: 14, M: 22, L: 18, XL: 2 },
    description:
      "Heavyweight cotton with the Passage symbol pressed small at the chest. Cut boxy, washed once so it never shrinks on you.",
    details: [
      "240gsm combed cotton",
      "Boxy fit, dropped shoulder",
      "Tonal symbol on chest",
    ],
  },
  {
    id: "tee-bone",
    slug: "passage-tee-bone",
    number: "02",
    name: "Passage Tee",
    line: "Bone",
    priceCents: 3800,
    art: "tee",
    tone: "bone",
    sizes: APPAREL,
    stock: { S: 9, M: 16, L: 0, XL: 6 },
    description:
      "The same tee in undyed bone. The symbol is printed in ink so it reads from across a room.",
    details: [
      "240gsm combed cotton",
      "Boxy fit, dropped shoulder",
      "Ink symbol on chest",
    ],
  },
  {
    id: "hoodie-graphite",
    slug: "heavyweight-hoodie",
    number: "03",
    name: "Heavyweight Hoodie",
    line: "Graphite",
    priceCents: 8800,
    art: "hoodie",
    tone: "graphite",
    sizes: APPAREL,
    stock: { S: 6, M: 11, L: 9, XL: 4 },
    description:
      "Loopback fleece with a double-layer hood and no drawcords to fight with. Warm enough for an office that keeps the AC on.",
    details: [
      "480gsm loopback fleece",
      "Double-layer hood",
      "Embroidered symbol, left cuff",
    ],
  },
  {
    id: "cap-ink",
    slug: "six-panel-cap",
    number: "04",
    name: "Six-Panel Cap",
    line: "Ink",
    priceCents: 3200,
    art: "cap",
    tone: "ink",
    sizes: null,
    stock: 30,
    description:
      "Unstructured washed twill with a brass slide at the back. The symbol is embroidered flat, not puffed.",
    details: ["Washed cotton twill", "Brass slide closure", "One size"],
  },
  {
    id: "socks",
    slug: "crew-socks",
    number: "05",
    name: "Crew Socks",
    line: "Two pairs",
    priceCents: 1800,
    art: "socks",
    tone: "bone",
    sizes: ["S/M", "L/XL"],
    stock: { "S/M": 24, "L/XL": 20 },
    description:
      "Ribbed combed cotton with a cushioned sole. One pair bone, one pair ink, symbol knitted into the cuff.",
    details: ["Combed cotton blend", "Cushioned footbed", "Two pairs per pack"],
  },
  {
    id: "mat",
    slug: "desk-mat",
    number: "06",
    name: "Desk Mat",
    line: "900 × 400",
    priceCents: 4200,
    art: "mat",
    tone: "ink",
    sizes: null,
    stock: 18,
    description:
      "A full-width felt-backed mat with stitched edges. Big enough for the keyboard, the mouse and the coffee.",
    details: ["900 × 400 × 4mm", "Stitched edges", "Non-slip rubber base"],
  },
  {
    id: "tote",
    slug: "canvas-tote",
    number: "07",
    name: "Canvas Tote",
    line: "Natural",
    priceCents: 2800,
    art: "tote",
    tone: "bone",
    sizes: null,
    stock: 26,
    description:
      "Twelve-ounce canvas with long handles and an inner pocket for keys. Carries a laptop without complaint.",
    details: [
      "12oz cotton canvas",
      "Inner zip pocket",
      "Shoulder-length handles",
    ],
  },
  {
    id: "stickers",
    slug: "sticker-sheet",
    number: "08",
    name: "Sticker Sheet",
    line: "Nine pieces",
    priceCents: 800,
    art: "stickers",
    tone: "bone",
    sizes: null,
    stock: 120,
    description:
      "Matte vinyl, die cut. The symbol in every finish we make it in, sized for a laptop lid or a water bottle.",
    details: [
      "Matte waterproof vinyl",
      "Nine die-cut pieces",
      "Dishwasher safe",
    ],
  },
  {
    id: "mug",
    slug: "ceramic-mug",
    number: "09",
    name: "Ceramic Mug",
    line: "Matte ink",
    priceCents: 2400,
    art: "mug",
    tone: "ink",
    sizes: null,
    stock: 15,
    description:
      "Stoneware with a matte glaze outside and gloss inside. Holds a proper 350ml and feels heavier than it looks.",
    details: ["350ml stoneware", "Matte outer glaze", "Microwave safe"],
  },
  {
    id: "pin",
    slug: "enamel-pin",
    number: "10",
    name: "Enamel Pin",
    line: "Polished steel",
    priceCents: 1200,
    art: "pin",
    tone: "steel",
    sizes: null,
    stock: 0,
    description:
      "Hard enamel on polished steel with two rubber backs. The first run went in a weekend.",
    details: ["Hard enamel", "25mm", "Two rubber clutches"],
  },
  {
    id: "jacket",
    slug: "shell-jacket",
    number: "11",
    name: "Shell Jacket",
    line: "Ink",
    priceCents: 24000,
    art: "jacket",
    tone: "ink",
    sizes: APPAREL,
    stock: { S: 3, M: 5, L: 4, XL: 1 },
    description:
      "Three-layer waterproof shell with taped seams and a hood that fits over a cap. Reflective symbol on the back yoke.",
    details: [
      "3-layer 20k waterproof",
      "Fully taped seams",
      "Reflective symbol, back yoke",
    ],
  },
  {
    id: "headphones",
    slug: "studio-headphones",
    number: "12",
    name: "Studio Headphones",
    line: "Graphite",
    priceCents: 18900,
    art: "headphones",
    tone: "graphite",
    sizes: null,
    stock: 8,
    description:
      "Closed-back, wireless, with forty hours between charges. Anodised cups with the symbol machined into each side.",
    details: ["40mm drivers", "40 hour battery", "Machined aluminium cups"],
  },
  {
    id: "object",
    slug: "sculpted-symbol",
    number: "13",
    name: "Sculpted Symbol",
    line: "Solid aluminium",
    priceCents: 12000,
    art: "object",
    tone: "steel",
    sizes: null,
    stock: 6,
    description:
      "The Passage symbol milled from a single block of aluminium and bead blasted. It sits on a desk and does nothing, beautifully.",
    details: [
      "Solid 6061 aluminium",
      "Bead-blasted finish",
      "Numbered underside",
    ],
    limited: "Edition of 40",
  },
  {
    id: "bundle",
    slug: "founders-bundle",
    number: "14",
    name: "Founders Bundle",
    line: "Hoodie, tee, cap",
    priceCents: 14800,
    art: "bundle",
    tone: "ink",
    sizes: APPAREL,
    stock: { S: 2, M: 4, L: 4, XL: 2 },
    description:
      "The hoodie, the ink tee and the cap in one numbered box, sized together. Made once, for the people who were here first.",
    details: [
      "Heavyweight Hoodie",
      "Passage Tee, Ink",
      "Six-Panel Cap",
      "Numbered box",
    ],
    limited: "Edition of 50",
  },
];

export const ONE_SIGNATURE_LIMIT_CENTS = 10_000;

export function productById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function productBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

export function skuFor(productId: string, size: string | null): string {
  return size ? `${productId}:${size}` : productId;
}

export function seedRows(): {
  sku: string;
  productId: string;
  size: string | null;
  stock: number;
}[] {
  return PRODUCTS.flatMap<{
    sku: string;
    productId: string;
    size: string | null;
    stock: number;
  }>((p) =>
    typeof p.stock === "number"
      ? [
          {
            sku: skuFor(p.id, null),
            productId: p.id,
            size: null,
            stock: p.stock,
          },
        ]
      : Object.entries(p.stock).map(([size, stock]) => ({
          sku: skuFor(p.id, size),
          productId: p.id,
          size,
          stock,
        })),
  );
}

export function formatUsd(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
