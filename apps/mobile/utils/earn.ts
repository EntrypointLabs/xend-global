import { z } from "zod";
export const EarnProviderSchema = z.enum(["kamino", "jupiter"]);
export type EarnProvider = z.infer<typeof EarnProviderSchema>;
export type EarnAction = "deposit" | "redeem";
const integer = z.string().regex(/^\d+$/);
export const EarnAssetSchema = z.object({
  mint: z.string(),
  symbol: z.string(),
  name: z.string(),
  iconUrl: z.string().nullable(),
  decimals: z.number().int().min(0).max(18),
  apy: z.number().finite().nonnegative().max(10).nullable(),
  positionRaw: integer,
  positionUsd: z.string().nullable(),
  withdrawableRaw: integer,
  lifetimeEarnedRaw: integer.nullable(),
  lastSevenDaysEarnedRaw: integer.nullable(),
  /** What the vault holds of this token and could deposit (lamports for SOL). */
  depositableRaw: integer,
  available: z.boolean(),
  withdrawAvailable: z.boolean(),
});
export const EarnCatalogSchema = z.object({
  depositableMinor: integer,
  lifetimeMinor: z
    .string()
    .regex(/^-?\d+$/)
    .nullable(),
  lastSevenDaysMinor: z
    .string()
    .regex(/^-?\d+$/)
    .nullable(),
  products: z.array(
    z.object({
      id: EarnProviderSchema,
      provider: z.string(),
      name: z.string(),
      apy: z.number().finite().nonnegative().max(10).nullable(),
      positionShares: integer,
      positionMinor: integer,
      withdrawableMinor: integer,
      available: z.boolean(),
      withdrawAvailable: z.boolean(),
      updatedAt: z.string().datetime(),
      lifetimeMinor: z
        .string()
        .regex(/^-?\d+$/)
        .nullable()
        .optional(),
      lastSevenDaysMinor: z
        .string()
        .regex(/^-?\d+$/)
        .nullable()
        .optional(),
      /** Every token the product lends. Absent on a USDC-only server. */
      assets: z.array(EarnAssetSchema).optional(),
    })
  ),
});
export const EarnQuoteSchema = z.object({
  provider: EarnProviderSchema,
  action: z.enum(["deposit", "redeem"]),
  amountMinor: integer,
  quoteId: z.string().uuid(),
  inputAmountRaw: integer,
  expectedOutRaw: integer,
  minimumOutRaw: integer,
  expiresAt: z.number().int(),
});
export type EarnQuote = z.infer<typeof EarnQuoteSchema>;
export const EarnPreparedSchema = z.object({
  quote: EarnQuoteSchema,
  unsignedTxBase64: z.string().max(2000),
  blockhash: z.string(),
  lastValidBlockHeight: z.number().int(),
  settingsAddress: z.string(),
  forwarderProgram: z.string(),
});

/** An unread or failed position is unknown, never an empty position. */
export function selectEarnBalance(
  products: { positionMinor: string }[] | undefined,
  failed = false
): number | null {
  if (!products || failed) return null;
  return products.reduce((sum, p) => sum + Number(p.positionMinor) / 1e6, 0);
}

/** Canonical USDC base units, floored to the slider's supported cent step. */
export function earnDepositLimit(raw: string | null | undefined): number {
  return raw == null ? 0 : Number(BigInt(raw) / 10000n) / 100;
}

export type EarnRange = "7d" | "30d" | "1y" | "all";

export const EarnHistorySchema = z.object({
  provider: EarnProviderSchema,
  points: z.array(
    z.object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      valueMinor: integer,
      earnedMinor: integer,
    })
  ),
});
export type EarnHistory = z.infer<typeof EarnHistorySchema>;

/**
 * Minor-unit earnings as a two-decimal string. A position valued a unit below
 * its principal right after a deposit is rounding, not a loss, so anything
 * under half a cent below zero reads as zero instead of "-0.00".
 */
export function formatEarnedMinor(minor: string | null | undefined): string {
  if (minor == null) return "—";
  const dollars = Number(minor) / 1e6;
  return (dollars < 0 && dollars > -0.005 ? 0 : dollars).toFixed(2);
}

export interface EarnBar {
  /** The last day the bar covers, as YYYY-MM-DD. */
  label: string;
  /** Total earned by the end of that day, in dollars. */
  earned: number;
}

const DAY = 86400000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * Where each bar of a range ends: seven days for 7D, ten three-day steps for
 * 30D, month ends for 1Y and ALL. ALL starts at the first snapshot and never
 * draws more than twelve bars.
 */
function slotEnds(range: EarnRange, first: string | undefined, today: Date) {
  const now = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  if (range === "7d")
    return Array.from({ length: 7 }, (_, i) => iso(now - (6 - i) * DAY));
  if (range === "30d")
    return Array.from({ length: 10 }, (_, i) => iso(now - (9 - i) * 3 * DAY));
  const monthEnd = (back: number) =>
    back === 0
      ? iso(now)
      : iso(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back + 1, 1) -
            DAY
        );
  let months = 12;
  if (range === "all") {
    const start = first ? new Date(`${first}T00:00:00Z`) : today;
    months =
      (today.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      today.getUTCMonth() -
      start.getUTCMonth() +
      1;
  }
  const ends = Array.from({ length: months }, (_, i) =>
    monthEnd(months - 1 - i)
  );
  if (ends.length <= 12) return ends;
  return Array.from(
    { length: 12 },
    (_, i) => ends[Math.round((i * (ends.length - 1)) / 11)]
  );
}

/**
 * Earnings as they build up over a range: each bar is the total earned by its
 * last day, so the bars climb the way the product sheet's chart does. A day
 * with no snapshot carries the last known total forward.
 */
export function earnBars(
  points: EarnHistory["points"],
  range: EarnRange,
  today: Date = new Date()
): { bars: EarnBar[]; earnedInRange: number } {
  // The server returns snapshots from the start of the range onwards, never
  // the one before it, so a day ahead of the first snapshot takes that
  // snapshot's total rather than zero.
  const first = points[0] ? Number(points[0].earnedMinor) / 1e6 : 0;
  const totalBy = (day: string) => {
    let total = first;
    for (const point of points) {
      if (point.day > day) break;
      total = Number(point.earnedMinor) / 1e6;
    }
    return total;
  };
  const ends = slotEnds(range, points[0]?.day, today);
  const bars = ends.map((label) => ({ label, earned: totalBy(label) }));
  // Without a snapshot from before the range there is no baseline, so the
  // range's earnings are measured from its first snapshot. ALL counts from
  // nothing, since its first snapshot is the first there is.
  const before = range === "all" ? 0 : first;
  return {
    bars,
    earnedInRange: Math.max(0, bars[bars.length - 1].earned - before),
  };
}

type EarnCatalog = z.infer<typeof EarnCatalogSchema>;

/**
 * One product's earnings, or null when the server does not break them out.
 * The account totals are not a stand-in: they include earnings from products
 * since withdrawn from, which would be credited to whichever one is held now.
 */
export function productEarnings(
  catalog: EarnCatalog | undefined,
  id: EarnProvider
): { lifetimeMinor: string | null; lastSevenDaysMinor: string | null } {
  const live = catalog?.products.find((row) => row.id === id);
  if (!catalog || !live)
    return { lifetimeMinor: null, lastSevenDaysMinor: null };
  return {
    lifetimeMinor: live.lifetimeMinor ?? null,
    lastSevenDaysMinor: live.lastSevenDaysMinor ?? null,
  };
}

export type TokenRange = "1d" | "1w" | "1m" | "6m" | "1y";

/** A token's price, its recent history and what the market trades of it. */
export const TokenOverviewSchema = z.object({
  mint: z.string(),
  name: z.string().nullable(),
  symbol: z.string().nullable(),
  iconUrl: z.string().nullable(),
  decimals: z.number().int().nullable(),
  priceUsd: z.number().nullable(),
  priceChange24h: z.number().nullable(),
  volume24hUsd: z.number().nullable(),
  points: z.array(z.object({ at: z.string(), priceUsd: z.number() })),
});
export type TokenOverview = z.infer<typeof TokenOverviewSchema>;
