import type { FiatOrder } from '../fiat.types';
import { checkUnverifiedLimit, nairaMinorOf, usedNairaMinor } from './limits';
import { providerFiatStatus } from '../fiat-state';

const LIMIT = 5_000_000n; // ₦50,000 in kobo

function order(
  naira: number,
  status: FiatOrder['status'],
  createdAt = new Date().toISOString(),
  simulation = false,
): FiatOrder {
  return {
    status,
    createdAt,
    simulation,
    quote: {
      debit: { currency: 'NGN', amountMinor: String(naira * 100), decimals: 2 },
      credit: { currency: 'USDC', amountMinor: '1', decimals: 6 },
    },
  } as unknown as FiatOrder;
}

describe('unverified naira allowance', () => {
  it('allows an order of exactly the limit and refuses one kobo more', () => {
    const at = (amount: bigint) =>
      checkUnverifiedLimit({
        amountMinor: amount,
        usedMinor: 0n,
        limitMinor: LIMIT,
        verified: false,
      }).verificationRequired;
    expect(at(LIMIT)).toBe(false);
    expect(at(LIMIT + 1n)).toBe(true);
  });

  it('counts the last 24 hours so a large amount cannot be split', () => {
    const since = Date.now() - 24 * 3_600_000;
    const used = usedNairaMinor(
      [order(30_000, 'completed'), order(10_000, 'awaiting_payment')],
      since,
    );
    expect(used).toBe(4_000_000n);
    expect(
      checkUnverifiedLimit({
        amountMinor: 1_000_000n,
        usedMinor: used,
        limitMinor: LIMIT,
        verified: false,
      }).verificationRequired,
    ).toBe(false);
    expect(
      checkUnverifiedLimit({
        amountMinor: 1_000_100n,
        usedMinor: used,
        limitMinor: LIMIT,
        verified: false,
      }).verificationRequired,
    ).toBe(true);
  });

  it('releases orders that ended without money moving, and ignores old and simulated ones', () => {
    const since = Date.now() - 24 * 3_600_000;
    const old = new Date(since - 1000).toISOString();
    expect(
      usedNairaMinor(
        [
          order(20_000, 'failed'),
          order(20_000, 'expired'),
          order(20_000, 'returned'),
          order(20_000, 'completed', old),
          order(20_000, 'completed', undefined, true),
        ],
        since,
      ),
    ).toBe(0n);
  });

  it('never asks a verified Consumer', () => {
    expect(
      checkUnverifiedLimit({
        amountMinor: 100_000_000n,
        usedMinor: LIMIT,
        limitMinor: LIMIT,
        verified: true,
      }).verificationRequired,
    ).toBe(false);
  });

  it('reads the naira side of either direction', () => {
    expect(
      nairaMinorOf({
        debit: { currency: 'USDC', amountMinor: '30000000', decimals: 6 },
        credit: { currency: 'NGN', amountMinor: '4500000', decimals: 2 },
      }),
    ).toBe(4_500_000n);
  });
});

describe('provider status updates', () => {
  it('moves forward and never reopens a settled order', () => {
    expect(providerFiatStatus('awaiting_payment', 'processing')).toBe(
      'processing',
    );
    expect(providerFiatStatus('processing', 'awaiting_payment')).toBe(
      'processing',
    );
    expect(providerFiatStatus('completed', 'needs_attention')).toBe(
      'completed',
    );
    expect(providerFiatStatus('failed', 'completed')).toBe('failed');
  });

  it('lets a deposit paid after the app window still complete', () => {
    expect(providerFiatStatus('expired', 'processing')).toBe('processing');
    expect(providerFiatStatus('expired', 'completed')).toBe('completed');
    expect(providerFiatStatus('processing', 'expired')).toBe('processing');
  });

  it('keeps a refund in progress until it is returned', () => {
    expect(providerFiatStatus('return_pending', 'processing')).toBe(
      'return_pending',
    );
    expect(providerFiatStatus('return_pending', 'returned')).toBe('returned');
  });
});
