/**
 * Database `mode` controls whether settlement is simulated. Devnet execution
 * uses the real settlement path, but it must never be represented to a
 * Merchant as production money or routed to production webhook endpoints.
 */
export function isLivePayment(
  mode: 'test' | 'live',
  executionCluster: string | null,
): boolean {
  return mode === 'live' && executionCluster !== 'devnet';
}

export function paymentDeliveryMode(
  mode: 'test' | 'live',
  executionCluster: string | null,
): 'test' | 'live' {
  return isLivePayment(mode, executionCluster) ? 'live' : 'test';
}
