import { z } from 'zod';
import type { FundingPlan, Holdings } from '../funding/funding-planner';

const money = z.string().regex(/^[1-9]\d{0,17}$/);
const key = z.string().min(8).max(100);
const currency = z.enum(['NGN', 'USDC']);
export const UnifiedReceiveBody = z
  .object({
    currency,
    amountMinor: money,
    idempotencyKey: key,
  })
  .strict();
export const UnifiedQuoteBody = z
  .object({
    destinationCurrency: currency,
    recipientMinor: money.optional(),
    sendAll: z.literal(true).optional(),
    destination: z.string().trim().min(1).max(200),
  })
  .strict()
  .refine((value) => Boolean(value.recipientMinor) !== Boolean(value.sendAll), {
    message: 'Provide recipientMinor or sendAll, exclusively.',
  });
export const UnifiedOrderBody = z
  .object({
    quoteId: z.string().uuid(),
    idempotencyKey: key,
    autoAdvance: z.boolean().optional(),
  })
  .strict();
export const UnifiedAdvanceBody = z
  .object({
    idempotencyKey: key,
    action: z.enum(['advance', 'fail']),
  })
  .strict();
export type ReceiveInput = z.infer<typeof UnifiedReceiveBody>;
export type QuoteInput = z.infer<typeof UnifiedQuoteBody>;
export type OrderInput = z.infer<typeof UnifiedOrderBody>;
export type AdvanceInput = z.infer<typeof UnifiedAdvanceBody>;

export interface UnifiedQuote {
  mode: 'simulation';
  id: string;
  plan: FundingPlan;
  destination: string;
  expiresAt: string;
}
export interface UnifiedOrder {
  autoAdvance: boolean;
  mode: 'simulation';
  id: string;
  plan: FundingPlan;
  destination: string;
  status: 'converting' | 'ready_to_send' | 'sending' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}
export type UnifiedRecord =
  | { kind: 'quote'; quote: UnifiedQuote; input: QuoteInput; orderId?: string }
  | { kind: 'order'; order: UnifiedOrder; converted: boolean }
  | { kind: 'mutation'; key: string; hash: string; response: unknown };
export interface UnifiedAggregate {
  holdings: Holdings;
  records: UnifiedRecord[];
}
