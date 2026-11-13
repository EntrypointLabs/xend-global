import { z } from 'zod';
export const FiatQuoteRequest = z
  .object({
    routeId: z.string().min(1).max(100),
    amountMinor: z.string().regex(/^[1-9]\d{0,14}$/),
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
