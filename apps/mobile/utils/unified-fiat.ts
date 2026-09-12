import { z } from "zod";
const minor = z.string().regex(/^(0|[1-9]\d*)$/);
const currency = z.enum(["NGN", "USDC"]);
export type UnifiedCurrency = z.infer<typeof currency>;
const holding = z.object({ settledMinor: minor, reservedMinor: minor });
export const UnifiedPlanSchema = z.object({
  destinationCurrency: currency,
  recipientMinor: minor,
  payoutFeeMinor: minor,
  directMinor: minor,
  shortfallMinor: minor,
  conversionSource: currency,
  availableConversionSourceMinor: minor,
  reservations: z.object({ NGN: minor, USDC: minor }),
  surplusDestinationMinor: minor,
  conversion: z
    .object({
      reference: z.string(),
      sourceCurrency: currency,
      destinationCurrency: currency,
      sourceDebitMinor: minor,
      destinationCreditMinor: minor,
      expiresAt: z.string().datetime(),
    })
    .nullable(),
});
export const UnifiedOrderSchema = z.object({
  id: z.string(),
  plan: UnifiedPlanSchema,
  destination: z.string(),
  mode: z.literal("simulation"),
  status: z.enum([
    "converting",
    "ready_to_send",
    "sending",
    "completed",
    "failed",
  ]),
  createdAt: z.string(),
  autoAdvance: z.boolean().optional().default(false),
});
export const UnifiedQuoteSchema = z.object({
  id: z.string(),
  plan: UnifiedPlanSchema,
  destination: z.string(),
  expiresAt: z.string().datetime(),
  mode: z.literal("simulation"),
});
export const UnifiedSnapshotSchema = z.object({
  mode: z.literal("simulation"),
  holdings: z.object({ NGN: holding, USDC: holding }),
  total: z.object({
    currency: z.enum(["USD", "NGN"]),
    decimals: z.literal(2),
    totalMinor: minor,
    availableMinor: minor,
    estimate: z.literal(true),
  }),
  orders: z.array(UnifiedOrderSchema),
});
export type UnifiedQuote = z.infer<typeof UnifiedQuoteSchema>;
export type UnifiedOrder = z.infer<typeof UnifiedOrderSchema>;
export type UnifiedQuoteInput = {
  destinationCurrency: UnifiedCurrency;
  destination: string;
} & (
  | { recipientMinor: string; sendAll?: never }
  | { sendAll: true; recipientMinor?: never }
);
export function unifiedMoney(
  amountMinor: string,
  currency: UnifiedCurrency | "USD"
): string {
  const decimals = currency === "USDC" ? 6 : 2;
  const digits = amountMinor.padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)} ${currency}`;
}
