// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { IntentView } from '../lib/api';
import { PaymentSheet } from './PaymentSheet';

afterEach(cleanup);

it('shows the pinned debit and expiry before approval', () => {
  const intent = {
    merchantDisplayName: 'Chowderr',
    displayCurrency: 'NGN',
    displayAmountMinor: '100000',
    usdcSettlementRaw: '751544',
    expiresAt: '2026-09-20T12:00:00Z',
  } as IntentView;
  const { container } = render(
    <PaymentSheet intent={intent}>
      <button>Approve</button>
    </PaymentSheet>,
  );
  expect(container.querySelector('details')).toBeNull();
  const quote = container.querySelector('.payment-more-info')!;
  expect(quote.textContent).toContain('0.751544 USDC');
  expect(quote.querySelector('time')?.dateTime).toBe(intent.expiresAt);
  expect(screen.queryByText('Pay from')).toBeNull();
  expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
});
