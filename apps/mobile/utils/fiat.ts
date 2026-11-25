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
const LimitCheckSchema = z.object({
  limitMinor: z.string().regex(/^\d+$/),
  usedMinor: z.string().regex(/^\d+$/),
  verificationRequired: z.boolean(),
});
export const FiatQuoteSchema = z.object({
  id: z.string(),
  route: FiatRouteSchema,
  reference: z.string(),
  expiresAt: z.string().datetime(),
  debit: money,
  credit: money,
  fees: z.array(money),
  fields: z.array(field),
  paymentStep: z.enum([
    "manual_transfer",
    "account_transfer",
    "redirect",
    "simulation",
  ]),
  verification: LimitCheckSchema.optional(),
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
    transferAmount: money.optional(),
    depositAddress: z.string().optional(),
    depositAmount: money.optional(),
    payoutAccountName: z.string().optional(),
    expiresAt: z.string().optional(),
    url: z.string().optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  simulation: z.boolean(),
});
export const FiatLimitsSchema = z.object({
  verified: z.boolean(),
  limitMinor: z.string().regex(/^\d+$/),
  used: z.object({
    receive: z.string().regex(/^\d+$/),
    send: z.string().regex(/^\d+$/),
  }),
  windowHours: z.number(),
});
export const VerificationSchema = z.object({
  status: z.enum([
    "unverified",
    "code_sent",
    "in_review",
    "verified",
    "declined",
  ]),
  declineCode: z.string().optional(),
  codeExpiresAt: z.string().optional(),
});
export const VerificationConsentSchema = z.object({
  version: z.string(),
  text: z.string(),
});
export const PayoutBankSchema = z.object({
  code: z.string(),
  name: z.string(),
  logoKey: z.string().nullable().optional(),
});
export type FiatLimits = z.infer<typeof FiatLimitsSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
export type PayoutBank = z.infer<typeof PayoutBankSchema>;
export type FiatMoney = z.infer<typeof money>;
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
/**
 * Naira left before verification is needed: the allowance minus the last 24h
 * in that direction. Adding and sending are counted apart.
 */
export function nairaAllowanceLeft(
  limits: FiatLimits,
  direction: FiatRoute["direction"]
): bigint {
  const left = BigInt(limits.limitMinor) - BigInt(limits.used[direction]);
  return left > 0n ? left : 0n;
}
/** Minor units as a plain decimal string, for sendCrypto and display. */
export function minorToPlain(amountMinor: string, decimals: number): string {
  const digits = amountMinor.padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
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

type CodedError = { data?: { code?: unknown; message?: unknown } };

/** The backend's typed refusal code, from the API or the demo backend. */
export function fiatErrorCode(err: unknown): string | null {
  const code = (err as CodedError | null)?.data?.code;
  return typeof code === "string" ? code : null;
}

/** A sentence safe to show: the backend's own, or the demo's. */
export function fiatErrorMessage(err: unknown): string | null {
  const message = (err as CodedError | null)?.data?.message;
  if (typeof message === "string") return message;
  if (fiatErrorCode(err) && err instanceof Error) return err.message;
  return null;
}
