import type { FiatDirection, FiatStatus } from '../fiat-provider.interface';
import type { FiatOrder, FiatQuote } from '../fiat.types';

export const DEFAULT_UNVERIFIED_LIMIT_NAIRA = 50_000;
export const LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// An order that ended without money moving no longer uses the allowance. An
// expired deposit that is paid late moves back to processing and counts again.
const RELEASED: ReadonlySet<FiatStatus> = new Set([
  'failed',
  'expired',
  'returned',
]);

/** The naira side of a quote: what is sent in, or what the bank receives. */
export function nairaMinorOf(quote: Pick<FiatQuote, 'debit' | 'credit'>) {
  if (quote.debit.currency === 'NGN') return BigInt(quote.debit.amountMinor);
  if (quote.credit.currency === 'NGN') return BigInt(quote.credit.amountMinor);
  return 0n;
}

/**
 * Adding and sending each have their own allowance, so naira added today does
 * not use up what can be sent today.
 */
export function usedNairaMinor(
  orders: FiatOrder[],
  since: number,
  direction: FiatDirection,
): bigint {
  return orders
    .filter(
      (order) =>
        !order.simulation &&
        order.route.direction === direction &&
        !RELEASED.has(order.status) &&
        Date.parse(order.createdAt) >= since,
    )
    .reduce((sum, order) => sum + nairaMinorOf(order.quote), 0n);
}

export interface LimitCheck {
  limitMinor: string;
  usedMinor: string;
  /** True when this amount needs a verified identity. */
  verificationRequired: boolean;
}

/**
 * Unverified Consumers may move up to the limit per order and up to the same
 * limit across any 24 hours in one direction, so a large amount cannot be
 * split to avoid it.
 */
export function checkUnverifiedLimit(input: {
  amountMinor: bigint;
  usedMinor: bigint;
  limitMinor: bigint;
  verified: boolean;
}): LimitCheck {
  const over =
    input.amountMinor > input.limitMinor ||
    input.usedMinor + input.amountMinor > input.limitMinor;
  return {
    limitMinor: input.limitMinor.toString(),
    usedMinor: input.usedMinor.toString(),
    verificationRequired: !input.verified && over,
  };
}
