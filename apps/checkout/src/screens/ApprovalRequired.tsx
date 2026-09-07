import type { IntentView } from '../lib/api';
import { formatMoney } from '../lib/money';

interface ApprovalRequiredProps {
  intent: IntentView;
  onCancel: () => void;
}

/**
 * Shown when the Payment is larger than the amount a single confirmation
 * carries, so it needs the second approval that lives on the Consumer's phone.
 *
 * Deliberately says what to do rather than why: the reason is a signer set, and
 * a shopper at a checkout has no use for that. Nothing has been charged at this
 * point, and the Payment is still waiting to be finished in the app.
 */
export function ApprovalRequired({ intent, onCancel }: ApprovalRequiredProps) {
  return (
    <div className="bg-brand-black flex h-full flex-col justify-end">
      <div className="border-brand-line bg-brand-surface rounded-t-3xl border-t px-6 pb-8 pt-7">
        <p className="text-brand-muted text-sm">
          Pay {intent.merchantDisplayName}
        </p>
        <p className="text-brand-ink mt-2 text-4xl font-semibold tabular-nums tracking-tight">
          {formatMoney(intent.displayCurrency, intent.displayAmountMinor)}
        </p>

        <h1 className="text-brand-ink mt-6 text-2xl font-semibold tracking-tight">
          Confirm this one on your phone
        </h1>
        <p className="text-brand-muted mt-2 text-sm leading-relaxed">
          Payments this size need a second confirmation from your phone. Open
          the Xend app to finish. You have not been charged.
        </p>

        <a
          href="https://xend.global/app"
          className="bg-brand-ink text-brand-black mt-8 block w-full rounded-2xl py-4 text-center text-base font-semibold"
        >
          Open Xend
        </a>
        <button
          type="button"
          onClick={onCancel}
          className="text-brand-muted mt-2 w-full py-3 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
