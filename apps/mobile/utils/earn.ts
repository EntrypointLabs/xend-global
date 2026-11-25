import { z } from "zod";
export const EarnProviderSchema = z.enum(["kamino", "jupiter"]);
export type EarnProvider = z.infer<typeof EarnProviderSchema>;
export type EarnAction = "deposit" | "redeem";
const integer = z.string().regex(/^\d+$/);
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
  label: string;
  earned: number;
}

/**
 * Dollars earned per bar for a range: a bar per day for 7D and 30D, per month
 * for 1Y and ALL. Points are cumulative, so each bar is the rise since the
 * previous snapshot; a fall (a withdrawal of earnings) counts as nothing.
 */
export function earnBars(
  points: EarnHistory["points"],
  range: EarnRange,
  today: Date = new Date()
): EarnBar[] {
  const monthly = range === "1y" || range === "all";
  const key = (day: string) => (monthly ? day.slice(0, 7) : day);
  const slots: string[] = [];
  const cursor = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  if (monthly) {
    const first = points[0]?.day.slice(0, 7);
    const count =
      range === "1y"
        ? 12
        : Math.max(
            1,
            first
              ? (cursor.getUTCFullYear() - Number(first.slice(0, 4))) * 12 +
                  cursor.getUTCMonth() -
                  (Number(first.slice(5, 7)) - 1) +
                  1
              : 1
          );
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1)
      );
      slots.push(d.toISOString().slice(0, 7));
    }
  } else {
    const count = range === "7d" ? 7 : 30;
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(cursor.getTime() - i * 86400000);
      slots.push(d.toISOString().slice(0, 10));
    }
  }
  const earned = new Map<string, number>();
  let previous: number | null = null;
  for (const point of points) {
    const total = Number(point.earnedMinor) / 1e6;
    const gain = previous === null ? 0 : Math.max(0, total - previous);
    previous = total;
    earned.set(key(point.day), (earned.get(key(point.day)) ?? 0) + gain);
  }
  return slots.map((slot) => ({ label: slot, earned: earned.get(slot) ?? 0 }));
}
