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
