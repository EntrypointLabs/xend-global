// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { IntentView } from '../lib/api';
import { PaymentSheet } from './PaymentSheet';

afterEach(cleanup);

it('keeps the pinned debit and expiry in a collapsed native disclosure', () => {
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
  const details = container.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(details.querySelector('summary')?.textContent).toBe('More info');
  expect(details.textContent).toContain('0.751544 USDC');
  expect(details.querySelector('time')?.dateTime).toBe(intent.expiresAt);
  expect(screen.queryByText('Pay from')).toBeNull();
  expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
});
