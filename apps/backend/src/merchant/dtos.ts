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
  currency: 'NGN' | 'USDC';
  amount: string;
  usdc_settlement_raw: string;
  ngn_display_minor: string | null;
  fx_rate: string | null;
  fx_source: string | null;
  fx_quoted_at: string | null;
  expires_at: string;
  merchant_reference: string | null;
  return_url: string | null;
  cancel_url: string | null;
  livemode: boolean;
  created: number;
}
