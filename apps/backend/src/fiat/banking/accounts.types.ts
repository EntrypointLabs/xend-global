import { z } from 'zod';
import type { BankAccount } from './banking-provider.interface';

export const CreateNairaAccountBody = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
    bvn: z
      .string()
      .regex(/^\d{11}$/)
      .optional(),
  })
  .strict();
export type CreateNairaAccountInput = z.infer<typeof CreateNairaAccountBody>;
export interface NairaAccountRecord {
  id: string;
  provider: string;
  environment: 'sandbox';
  currency: 'NGN';
  status: 'creating' | 'active' | 'needs_attention';
  account: BankAccount | null;
  createdAt: string;
  updatedAt: string;
}
