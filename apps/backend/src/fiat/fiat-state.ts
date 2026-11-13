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
