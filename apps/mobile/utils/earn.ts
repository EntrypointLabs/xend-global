import { z } from "zod";
export const EarnProviderSchema = z.enum(["kamino", "jupiter"]);
export type EarnProvider = z.infer<typeof EarnProviderSchema>;
export type EarnAction = "deposit" | "redeem";
const integer = z.string().regex(/^\d+$/);
export const EarnCatalogSchema = z.object({
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
