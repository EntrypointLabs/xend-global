import type { IntentView } from '../lib/api';
import { formatAmount } from '../lib/money';

/** The exact pinned debit, shown before either first or repeat approval. */
export function PaymentQuote({ intent }: { intent: IntentView }) {
  return (
    <>
      <div className="row">
        <dt>You pay</dt>
        <dd className="tabular-nums">
          {formatAmount('USDC', intent.usdcSettlementRaw).replace(
            /(\.\d*?[1-9])0+$/,
            '$1',
          )}{' '}
          USDC
        </dd>
      </div>
      <div className="row">
        <dt>Price held until</dt>
        <dd>
          <time
            dateTime={intent.expiresAt}
            title="Return to the store for a new quote after expiry."
          >
            {new Date(intent.expiresAt).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </time>
        </dd>
      </div>
    </>
  );
}
