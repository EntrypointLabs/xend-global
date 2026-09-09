import { z } from "zod";
export const NairaTransferSchema = z.object({
  id: z.string().uuid(),
  environment: z.literal("sandbox"),
  provider: z.literal("paga"),
  currency: z.literal("NGN"),
  status: z.enum(["quoted", "submitting", "completed", "needs_attention"]),
  sourceAccountNumber: z.string().regex(/^\d{10}$/),
  destination: z.object({
    accountNumber: z.string().regex(/^\d{10}$/),
    accountName: z.string(),
  }),
  amountMinor: z.string().regex(/^[1-9]\d*$/),
  feeMinor: z.null(),
  narration: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string(),
  updatedAt: z.string(),
  providerReference: z.string().nullable(),
});
export const NairaTransfersSchema = z.object({
  environment: z.literal("sandbox"),
  available: z.boolean(),
  scope: z.literal("xend_paga_accounts"),
  transfers: z.array(NairaTransferSchema),
});
export type NairaTransfer = z.infer<typeof NairaTransferSchema>;
