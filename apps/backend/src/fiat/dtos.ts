import { z } from 'zod';
export const FiatQuoteRequest = z
  .object({
    routeId: z.string().min(1).max(100),
    amountMinor: z.string().regex(/^[1-9]\d{0,14}$/),
    /** credit: amountMinor is what the recipient gets, not what is sent. */
    side: z.enum(['debit', 'credit']).optional(),
  })
  .strict();
export const FiatOrderRequest = z
  .object({
    quoteId: z.string().min(1).max(100),
    idempotencyKey: z.string().min(8).max(100),
    fields: z.record(z.string().max(100), z.string().max(500)).default({}),
  })
  .strict();
export const FiatSimulationRequest = z
  .object({
    event: z.enum(['payment_received', 'complete', 'fail', 'return', 'expire']),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
export type FiatQuoteRequestBody = z.infer<typeof FiatQuoteRequest>;
export type FiatOrderRequestBody = z.infer<typeof FiatOrderRequest>;
export type FiatSimulationRequestBody = z.infer<typeof FiatSimulationRequest>;
export const VerificationStartRequest = z
  .object({
    bvn: z.string().regex(/^\d{11}$/, 'A BVN is 11 digits.'),
    consentVersion: z.string().min(1).max(50),
  })
  .strict();
export const VerificationCodeRequest = z
  .object({ code: z.string().regex(/^\d{4,8}$/) })
  .strict();
export const AccountNumberParam = z.string().regex(/^\d{10}$/);
export const BankAccountLookupRequest = z
  .object({
    bankCode: z.string().min(1).max(40),
    accountNumber: z.string().regex(/^\d{10}$/),
  })
  .strict();
export type VerificationStartBody = z.infer<typeof VerificationStartRequest>;
export type VerificationCodeBody = z.infer<typeof VerificationCodeRequest>;
export type BankAccountLookupBody = z.infer<typeof BankAccountLookupRequest>;
