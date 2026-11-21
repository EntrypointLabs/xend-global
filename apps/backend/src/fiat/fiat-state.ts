import type { FiatStatus } from './fiat-provider.interface';
import type { SimulationEvent } from './fiat.types';
import { FiatError } from './fiat.errors';

/** Simulator uses the same distinction between failure before/after funding. */
export function nextFiatStatus(
  status: FiatStatus,
  event: SimulationEvent,
): FiatStatus {
  const transitions: Partial<
    Record<FiatStatus, Partial<Record<SimulationEvent, FiatStatus>>>
  > = {
    awaiting_payment: {
      payment_received: 'processing',
      fail: 'failed',
      expire: 'expired',
    },
    processing: {
      payment_received: 'processing',
      complete: 'completed',
      fail: 'return_pending',
    },
    expired: { payment_received: 'needs_attention' },
    needs_attention: { fail: 'return_pending', return: 'returned' },
    return_pending: { return: 'returned', fail: 'return_pending' },
  };
  const next = transitions[status]?.[event];
  if (!next)
    throw new FiatError(
      'ORDER_CONFLICT',
      'This update does not apply to the current order state.',
      409,
    );
  return next;
}

const SETTLED: ReadonlySet<FiatStatus> = new Set([
  'completed',
  'failed',
  'returned',
]);

/**
 * Applies a provider's reported status. A settled order never changes, and a
 * report never moves an order back to waiting for payment. An expired
 * deposit that the provider later sees paid moves forward, because the
 * provider keeps the account open after the app stops showing it.
 */
export function providerFiatStatus(
  current: FiatStatus,
  reported: FiatStatus,
): FiatStatus {
  if (SETTLED.has(current) || reported === current) return current;
  if (reported === 'creating') return current;
  if (reported === 'awaiting_payment') {
    return current === 'creating' || current === 'needs_attention'
      ? reported
      : current;
  }
  if (reported === 'expired') {
    return current === 'awaiting_payment' || current === 'creating'
      ? reported
      : current;
  }
  if (current === 'return_pending' && reported !== 'returned') return current;
  return reported;
}
