import type { ReactNode } from 'react';
import type { IntentView } from '../lib/api';
import { formatMoney } from '../lib/money';
import { PaymentQuote } from './PaymentQuote';
import { PayShell } from './StatusSheet';
import { PassageMark } from './glyphs';

function hostOf(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export function MerchantLine({ intent }: { intent: IntentView }) {
  const host = hostOf(intent.merchantOrigin);
  return (
    <div className="merchant">
      <span className="merchant-mark" aria-hidden="true">
        {intent.merchantDisplayName.slice(0, 1).toUpperCase()}
      </span>
      <span className="merchant-text">
        <span className="merchant-name">{intent.merchantDisplayName}</span>
        {host && <span className="merchant-host">{host}</span>}
      </span>
    </div>
  );
}

/** Shared purchase details for first-time and recognized Consumers. */
export function PaymentSheet({
  intent,
  children,
}: {
  intent: IntentView;
  children: ReactNode;
}) {
  return (
    <PayShell labelledBy="payment-title">
      <MerchantLine intent={intent} />
      <div className="total">
        <h1 id="payment-title" className="total-label">
          <span aria-hidden="true">Total</span>
          <span className="sr-only">Pay {intent.merchantDisplayName}</span>
        </h1>
        <p className="total-value">
          {formatMoney(intent.displayCurrency, intent.displayAmountMinor)}
        </p>
      </div>
      <dl className="payment-more-info">
        <div className="row">
          <dt>Pay with</dt>
          <dd>
            <span className="cash-chip" aria-hidden="true">
              <PassageMark className="h-2.5 w-2.5" />
            </span>
            Prydd Cash
          </dd>
        </div>
        <PaymentQuote intent={intent} />
      </dl>
      <div className="payment-actions">{children}</div>
    </PayShell>
  );
}
