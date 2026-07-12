import { createHash } from 'node:crypto';
import type { paymentIntents, payments } from '../db/schema';

type IntentRow = typeof paymentIntents.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

/**
 * The settlement block on the event payload. Aligns to
 * settlement_accounts (provider, currency, provider_reference) plus the
 * extended SettlementCompletion (status, completed_at, ngn_settled_minor):
 * it carries the provider completion (convert-at-settlement paid semantics),
 * not just the USDC tx. For the direct-USDC pilot the naira optionals are
 * null, which is correct.
 */
export interface EventSettlement {
  provider: string | null;
  currency: string | null;
  status: string;
  completedAt?: string | null;
  providerReference?: string | null;
  ngnSettledMinor?: string | null;
}

/**
 * Deterministic event id: stable across re-consumption and redelivery so the
 * merchant dedups on one id (REQ-IDEMPOTENCY). The id inside the signed body
 * is the dedup key; any duplicate transport header is unsigned convenience.
 */
export function buildEventId(topic: string, intentId: string): string {
  return (
    'evt_' +
    createHash('sha256')
      .update(`${topic}:${intentId}`)
      .digest('hex')
      .slice(0, 24)
  );
}

export interface BuildEventPayloadParams {
  eventId: string;
  type: string;
  livemode: boolean;
  correlationId: string;
  intent: IntentRow;
  payment?: PaymentRow | null;
  settlement?: EventSettlement | null;
}

/** The canonical event object. Callers JSON.stringify once and sign/store
 *  those exact bytes (never re-serialize, PITFALLS 7.2). Full object per
 *  event: at-least-once and unordered, the object is the truth. */
export function buildEventPayload(params: BuildEventPayloadParams): {
  id: string;
  object: 'event';
  type: string;
  created: number;
  livemode: boolean;
  correlation_id: string;
  data: { object: Record<string, unknown> };
} {
  const { intent, payment, settlement } = params;
  const status = params.type.replace('payment.', '');
  const currency = intent.ngnDisplayMinor !== null ? 'NGN' : 'USDC';
  const amount =
    currency === 'NGN'
      ? (intent.ngnDisplayMinor as string)
      : intent.usdcSettlementRaw;

  return {
    id: params.eventId,
    object: 'event',
    type: params.type,
    created: Math.floor(Date.now() / 1000),
    livemode: params.livemode,
    correlation_id: params.correlationId,
    data: {
      object: {
        id: payment?.id ?? null,
        intent_id: intent.id,
        status,
        currency,
        amount,
        usdc_settlement_raw: intent.usdcSettlementRaw,
        ngn_display_minor: intent.ngnDisplayMinor,
        merchant_reference: intent.merchantReference,
        tx_signature: payment?.txSignature ?? null,
        settled_at: payment?.settledAt ? payment.settledAt.toISOString() : null,
        occurred_at: new Date().toISOString(),
        settlement: {
          provider: settlement?.provider ?? null,
          currency: settlement?.currency ?? null,
          status: settlement?.status ?? 'pending',
          completed_at: settlement?.completedAt ?? null,
          provider_reference: settlement?.providerReference ?? null,
          ngn_settled_minor: settlement?.ngnSettledMinor ?? null,
        },
      },
    },
  };
}
