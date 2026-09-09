import { z } from 'zod';
export const NairaTransferQuoteBody = z
  .object({
    destinationAccountNumber: z.string().regex(/^\d{10}$/),
    amountMinor: z.string().regex(/^[1-9]\d{0,14}$/),
    narration: z.string().trim().max(200).default('Xend transfer'),
  })
  .strict();
export const NairaTransferBody = z
  .object({
    quoteId: z.string().uuid(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
export type NairaTransferQuoteInput = z.infer<typeof NairaTransferQuoteBody>;
export type NairaTransferInput = z.infer<typeof NairaTransferBody>;
export interface NairaTransferRecord {
  id: string;
  environment: 'sandbox';
  provider: 'paga';
  currency: 'NGN';
  status: 'quoted' | 'submitting' | 'completed' | 'needs_attention';
  sourceAccountNumber: string;
  destination: { accountNumber: string; accountName: string };
  amountMinor: string;
  feeMinor: null;
  narration: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  providerReference: string | null;
}
