import { z } from 'zod';

const accountNumber = z.string().regex(/^\d{10}$/);

export const BankCandidatesBody = z.object({ accountNumber }).strict();
export const ResolveBankRecipientBody = z
  .object({ accountNumber, bankCode: z.string().trim().min(3).max(64) })
  .strict();
export type BankCandidatesInput = z.infer<typeof BankCandidatesBody>;
export type ResolveBankRecipientInput = z.infer<
  typeof ResolveBankRecipientBody
>;

export interface BankListing {
  code: string;
  name: string;
}
export interface ResolvedBankRecipient {
  accountNumber: string;
  bankCode: string;
  bankName: string;
  accountName: string;
}
