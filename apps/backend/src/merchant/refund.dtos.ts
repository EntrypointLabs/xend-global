import { z } from 'zod';

/**
 * POST /internal/refunds body. amount omitted = full remaining refundable;
 * present = a partial refund. Ops-initiated: no merchant key, no browser.
 */
export const CreateRefundBodySchema = z.object({
  payment_id: z.string().min(1),
  amount_usdc_raw: z.string().regex(/^\d+$/).optional(),
  reason: z.string().max(500).optional(),
});
export type CreateRefundBody = z.infer<typeof CreateRefundBodySchema>;

export interface RefundObject {
  id: string;
  object: 'refund';
  payment_id: string;
  status: string;
  amount_usdc_raw: string;
  provider_reference: string | null;
  created: number;
}
