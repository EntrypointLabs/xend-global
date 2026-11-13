import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentQuote } from './PaymentQuote';
import type { IntentView } from '../lib/api';

describe('PaymentQuote', () => {
  it('shows the exact six-decimal debit and the pinned expiry', () => {
    const intent = {
      usdcSettlementRaw: '333333333',
      expiresAt: '2026-09-15T12:00:00.000Z',
    } as IntentView;
    const html = renderToStaticMarkup(<PaymentQuote intent={intent} />);
    expect(html).toContain('333.333333');
    expect(html).toContain('USDC');
    expect(html).toContain('2026-09-15T12:00:00.000Z');
    expect(html).toContain('new quote after expiry');
  });
});
