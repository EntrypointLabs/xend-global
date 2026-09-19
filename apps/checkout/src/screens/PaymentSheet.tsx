import type { ReactNode } from 'react';
import type { IntentView } from '../lib/api';
import { formatMoney } from '../lib/money';
import { PaymentQuote } from './PaymentQuote';

/** Shared purchase details for first-time and recognized Consumers. */
export function PaymentSheet({
  intent,
  children,
}: {
  intent: IntentView;
  children: ReactNode;
}) {
  return (
    <main className="payment-stage">
      <section className="payment-sheet" aria-labelledby="payment-title">
        <header className="payment-header">
          <span className="payment-wordmark">Xend</span>
          <span className="payment-header-label">Checkout</span>
        </header>
        <div className="payment-purchase">
          <span className="payment-merchant-mark" aria-hidden="true">
            {intent.merchantDisplayName.slice(0, 1).toUpperCase()}
          </span>
          <h1 id="payment-title">Pay {intent.merchantDisplayName}</h1>
          <p className="payment-total">
            {formatMoney(intent.displayCurrency, intent.displayAmountMinor)}
          </p>
        </div>
        <details className="payment-more-info">
          <summary>More info</summary>
          <PaymentQuote intent={intent} />
        </details>
        <div className="payment-actions">{children}</div>
      </section>
    </main>
  );
}
