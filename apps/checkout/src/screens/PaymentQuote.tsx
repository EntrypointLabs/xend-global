import type { IntentView } from '../lib/api';
import { formatMoney } from '../lib/money';

/** The exact pinned debit, shown before either first or repeat approval. */
export function PaymentQuote({ intent }: { intent: IntentView }) {
  return (
    <div className="text-brand-muted mt-3 text-sm leading-relaxed">
      <p>
        You pay {formatMoney('USDC', intent.usdcSettlementRaw).slice(1)} USDC
      </p>
      <p>
        Quote expires at{' '}
        <time dateTime={intent.expiresAt}>
          {new Date(intent.expiresAt).toLocaleTimeString()}
        </time>
        . Return to the store for a new quote after expiry.
      </p>
    </div>
  );
}
