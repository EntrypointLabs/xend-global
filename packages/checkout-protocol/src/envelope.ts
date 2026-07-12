import { z } from 'zod';
import type { CheckoutEnvelope, CheckoutStatus } from './types';

/** Bump only for a breaking envelope change; consumers ignore unknown versions. */
export const CHECKOUT_PROTOCOL_VERSION = 1 as const;

/** The one origin the checkout surface is ever served from. */
export const CHECKOUT_ORIGIN = 'https://pay.xend.global' as const;

export const CheckoutMessageType = {
  Result: 'xend.checkout.result',
  Cancel: 'xend.checkout.cancel',
} as const;

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

export function buildResult(
  nonce: string,
  reference: string,
  status: CheckoutStatus,
): CheckoutEnvelope {
  return {
    xend: 'checkout',
    v: CHECKOUT_PROTOCOL_VERSION,
    nonce,
    reference,
    type: CheckoutMessageType.Result,
    status,
  };
}

/** User-initiated close/back-out; carries status 'canceled' by contract. */
export function buildCancel(
  nonce: string,
  reference: string,
): CheckoutEnvelope {
  return {
    xend: 'checkout',
    v: CHECKOUT_PROTOCOL_VERSION,
    nonce,
    reference,
    type: CheckoutMessageType.Cancel,
    status: 'canceled',
  };
}

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
