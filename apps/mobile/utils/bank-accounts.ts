import { z } from "zod";
export const BankAccountInputSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email(),
    bvn: z
      .string()
      .regex(/^\d{11}$/)
      .optional(),
  })
  .strict();
export type BankAccountInput = z.infer<typeof BankAccountInputSchema>;
export const BankAccountRecordSchema = z.object({
  id: z.string(),
  provider: z.enum(["nomba", "paga"]),
  environment: z.literal("sandbox"),
  currency: z.literal("NGN"),
  status: z.enum(["creating", "active", "needs_attention"]),
  account: z
    .object({
      provider: z.string(),
      reference: z.string(),
      accountNumber: z.string().regex(/^\d{10}$/),
      accountName: z.string(),
      bankName: z.string(),
      currency: z.literal("NGN"),
      custody: z.enum(["pooled", "individual"]),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const BankAccountsSchema = z.object({
  provider: z.enum(["nomba", "paga"]).nullable(),
  environment: z.literal("sandbox"),
  available: z.boolean(),
  reconciliationAvailable: z.boolean(),
  accounts: z.array(BankAccountRecordSchema),
});
