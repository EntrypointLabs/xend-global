import { z } from "zod";

export const BankSchema = z.object({ code: z.string(), name: z.string() });
export const BankListSchema = z.object({ banks: z.array(BankSchema) });
export const ResolvedBankRecipientSchema = z.object({
  accountNumber: z.string().regex(/^\d{10}$/),
  bankCode: z.string(),
  bankName: z.string(),
  accountName: z.string().min(1),
});

export type Bank = z.infer<typeof BankSchema>;

/** The bank answered, and has no account with that number. */
export class BankAccountNotFoundError extends Error {
  constructor() {
    super("Bank account not found");
    this.name = "BankAccountNotFoundError";
  }
}
