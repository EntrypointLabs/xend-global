import { z } from 'zod';
import type { CheckoutEnvelope } from './types';
import { CHECKOUT_PROTOCOL_VERSION, CheckoutMessageType } from './build';

export const CheckoutStatusSchema = z.enum([
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);

export const CheckoutEnvelopeSchema = z.object({
  xend: z.literal('checkout'),
  v: z.literal(CHECKOUT_PROTOCOL_VERSION),
  nonce: z.string().min(1),
  reference: z.string().min(1),
  type: z.enum([CheckoutMessageType.Result, CheckoutMessageType.Cancel]),
  status: CheckoutStatusSchema,
}) satisfies z.ZodType<CheckoutEnvelope>;

/**
 * The consumer-side guard used by BOTH the SDK (listening for
 * CHECKOUT_ORIGIN) and the popup (validating an opener handshake).
 * Exact string equality only: no includes/startsWith/regex, and a
 * literal 'null' origin (sandboxed frame) is always rejected.
 */
export function parseCheckoutMessage(
  event: { origin: string; data: unknown },
  expected: { origin: string; nonce: string; reference: string },
): CheckoutEnvelope | null {
  if (event.origin === 'null' || event.origin !== expected.origin) return null;
  const parsed = CheckoutEnvelopeSchema.safeParse(event.data);
  if (!parsed.success) return null;
  if (parsed.data.v !== CHECKOUT_PROTOCOL_VERSION) return null;
  if (parsed.data.nonce !== expected.nonce) return null;
  if (parsed.data.reference !== expected.reference) return null;
  return parsed.data;
}
