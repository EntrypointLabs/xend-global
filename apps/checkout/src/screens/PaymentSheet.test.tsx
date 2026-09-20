// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { IntentView } from '../lib/api';
import { PaymentSheet } from './PaymentSheet';

afterEach(cleanup);

const intentFixture = {
  merchantDisplayName: 'Chowderr',
  displayCurrency: 'NGN',
  displayAmountMinor: '100000',
  usdcSettlementRaw: '751544',
  expiresAt: '2026-09-20T12:00:00Z',
} as IntentView;

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

it('exposes the disclosure through a native summary a keyboard and screen reader can operate', () => {
  const { container } = render(
    <PaymentSheet intent={intentFixture}>
      <button>Approve</button>
    </PaymentSheet>,
  );
  const details = container.querySelector('details')!;
  const summary = details.querySelector('summary')!;
  // A native <summary> is focusable and operable by Enter/Space without any
  // added tabindex or key handler, which is what keyboard and mobile
  // acceptance rely on; a custom div would have needed both.
  expect(summary.tagName).toBe('SUMMARY');
  expect(summary.hasAttribute('tabindex')).toBe(false);

  // Toggling the summary reveals the pinned debit and collapses it again, the
  // same open/close the native control drives from a tap or a keypress.
  expect(details.open).toBe(false);
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  expect(details.textContent).toContain('0.751544 USDC');
  fireEvent.click(summary);
  expect(details.open).toBe(false);
});
