import { z } from "zod";

const currency = z.enum(["NGN", "USDC"]);
export const FiatRouteSchema = z.object({
  id: z.string(),
  provider: z.string(),
  direction: z.enum(["receive", "send"]),
  environment: z.enum(["simulation", "sandbox", "production"]),
  sourceCurrency: currency,
  destinationCurrency: currency,
  network: z.literal("solana"),
  quoteAvailable: z.boolean(),
  orderAvailable: z.boolean(),
  accountKinds: z.array(z.enum(["temporary", "permanent"])),
  holdsFiat: z.boolean(),
  thirdPartyPayments: z.enum(["supported", "unsupported", "unknown"]),
});
const money = z.object({
  currency,
  amountMinor: z.string().regex(/^\d+$/),
  decimals: z.union([z.literal(2), z.literal(6)]),
});
const field = z.discriminatedUnion("type", [
  z.object({
    key: z.string(),
    label: z.string(),
    required: z.boolean(),
    type: z.literal("text"),
  }),
  z.object({
    key: z.string(),
    label: z.string(),
    required: z.boolean(),
    type: z.literal("select"),
    options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
  }),
]);
export const FiatQuoteSchema = z.object({
  id: z.string(),
  route: FiatRouteSchema,
  reference: z.string(),
  expiresAt: z.string().datetime(),
  debit: money,
  credit: money,
  fees: z.array(money),
  fields: z.array(field),
  paymentStep: z.enum(["manual_transfer", "redirect", "simulation"]),
});
export const FiatOrderSchema = z.object({
  id: z.string(),
  route: FiatRouteSchema,
  quote: FiatQuoteSchema,
  status: z.enum([
    "creating",
    "awaiting_payment",
    "processing",
    "completed",
    "expired",
    "failed",
    "needs_attention",
    "return_pending",
    "returned",
  ]),
  instructions: z.object({
    kind: z.enum([
      "simulation",
      "bank_transfer",
      "crypto_transfer",
      "redirect",
    ]),
    message: z.string(),
    accountNumber: z.string().optional(),
    bankName: z.string().optional(),
    accountName: z.string().optional(),
    expiresAt: z.string().optional(),
    url: z.string().optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  simulation: z.boolean(),
});
export type FiatRoute = z.infer<typeof FiatRouteSchema>;
export type FiatQuote = z.infer<typeof FiatQuoteSchema>;
export type FiatOrder = z.infer<typeof FiatOrderSchema>;
export type FiatSimulationEvent =
  | "payment_received"
  | "complete"
  | "fail"
  | "return"
  | "expire";

/** Never round money through a JS floating-point number. */
export function fiatAmountMinor(input: string, decimals: 2 | 6): string | null {
  if (!/^\d+(\.\d+)?$/.test(input) || input.length > 30) return null;
  const [whole, fraction = ""] = input.split(".");
  if (fraction.length > decimals) return null;
  const minor =
    (whole + fraction.padEnd(decimals, "0")).replace(/^0+/, "") || "0";
  return minor === "0" ? null : minor;
}
export function fiatMoneyLabel(value: z.infer<typeof money>): string {
  const digits = value.amountMinor.padStart(value.decimals + 1, "0");
  return `${digits.slice(0, -value.decimals)}.${digits.slice(-value.decimals)} ${value.currency}`;
}
export function fiatFieldsValid(
  quote: FiatQuote,
  values: Record<string, string>
): boolean {
  return quote.fields.every((f) => {
    const value = values[f.key]?.trim() || "";
    return (
      (!f.required && !value) ||
      (Boolean(value) &&
        (f.type !== "select" || f.options.some((o) => o.value === value)))
    );
  });
}
