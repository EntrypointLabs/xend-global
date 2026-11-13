import { z } from "zod";
const units = z.string().regex(/^(0|[1-9]\d*)$/);
export const ObservedHoldingSchema = z
  .object({
    currency: z.enum(["NGN", "USDC"]),
    decimals: z.union([z.literal(2), z.literal(6)]),
    status: z.enum(["available", "unavailable"]),
    amountMinor: units.nullable(),
    observedAt: z.string().datetime().nullable(),
    reason: z.string().nullable(),
  })
  .superRefine((h, ctx) => {
    if (
      (h.currency === "NGN" ? 2 : 6) !== h.decimals ||
      (h.status === "available" &&
        (h.amountMinor === null || h.observedAt === null)) ||
      (h.status === "unavailable" && h.amountMinor !== null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent observed holding",
      });
  });
export const ObservedBalancesSchema = z
  .object({
    mode: z.literal("observed"),
    bankEnvironment: z.literal("sandbox"),
    network: z.enum(["devnet", "mainnet"]).nullable(),
    holdings: z.array(ObservedHoldingSchema).length(2),
    total: z
      .object({
        currency: z.literal("USD"),
        amountMinor: units,
        estimate: z.literal(true),
        asOf: z.string().datetime(),
      })
      .nullable(),
    valuationReason: z.string().nullable(),
  })
  .superRefine((r, ctx) => {
    if (
      new Set(r.holdings.map((h) => h.currency)).size !== 2 ||
      (r.total &&
        (r.network !== "devnet" ||
          r.holdings.some((h) => h.status !== "available")))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cannot value incomplete or mismatched environments",
      });
  });
