import { z } from 'zod';
import type { CheckoutEnvelope, CheckoutReadyEnvelope } from './types';
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

export const CheckoutReadyEnvelopeSchema = z.object({
  xend: z.literal('checkout'),
  v: z.literal(CHECKOUT_PROTOCOL_VERSION),
  nonce: z.string().min(1),
  type: z.literal(CheckoutMessageType.Ready),
}) satisfies z.ZodType<CheckoutReadyEnvelope>;

/**
 * The consumer-side guard used by BOTH the SDK (listening for
 * CHECKOUT_ORIGIN) and the popup (validating an opener handshake).
 * Exact string equality only: no includes/startsWith/regex, and a
 * literal 'null' origin (sandboxed frame) is always rejected.
 *
 * The two envelope shapes come back as themselves, discriminated by `type`, so
 * reading a status off a handshake is a compile error rather than an undefined.
 * A ready envelope is matched on the nonce alone, because it has no reference
 * to match: the handshake can happen before the intent is appended to the URL.
 */
export function parseCheckoutMessage(
  event: { origin: string; data: unknown },
  expected: { origin: string; nonce: string; reference: string },
): CheckoutEnvelope | CheckoutReadyEnvelope | null {
  if (event.origin === 'null' || event.origin !== expected.origin) return null;

  const ready = CheckoutReadyEnvelopeSchema.safeParse(event.data);
  if (ready.success) {
    if (ready.data.v !== CHECKOUT_PROTOCOL_VERSION) return null;
    if (ready.data.nonce !== expected.nonce) return null;
    return ready.data;
  }

  const parsed = CheckoutEnvelopeSchema.safeParse(event.data);
  if (!parsed.success) return null;
  if (parsed.data.v !== CHECKOUT_PROTOCOL_VERSION) return null;
  if (parsed.data.nonce !== expected.nonce) return null;
  if (parsed.data.reference !== expected.reference) return null;
  return parsed.data;
}
