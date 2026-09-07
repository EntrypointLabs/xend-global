import { z } from 'zod';

/**
 * POST /v1/payment_intents body. Server-to-server only: the amount is a raw
 * minor-unit string the merchant server supplies, never a browser. return_url
 * and cancel_url are SSRF-validated by the controller before use.
 */
export const CreateIntentBodySchema = z.object({
  amount: z.string().regex(/^\d+$/),
  currency: z.enum(['NGN', 'USDC']),
  merchant_reference: z.string().max(255).optional(),
  return_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});
export type CreateIntentBody = z.infer<typeof CreateIntentBodySchema>;

/** The merchant-facing payment intent object (Stripe-shaped). */
export interface IntentObject {
  id: string;
  object: 'payment_intent';
  status: string;
  /**
   * The currency and unit the Merchant created the intent in, echoed back
   * unchanged: NGN in kobo, USDC in its own six decimals. A shopper priced in
   * USDC is shown dollars at the checkout, but that is a display concern and
   * never changes what the Merchant reads back.
   */
  currency: string;
  amount: string;
  usdc_settlement_raw: string;
  fx_rate: string | null;
  fx_source: string | null;
  fx_quoted_at: string | null;
  expires_at: string;
  merchant_reference: string | null;
  return_url: string | null;
  cancel_url: string | null;
  livemode: boolean;
  created: number;
  metadata: Record<string, string> | null;
}
