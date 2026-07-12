import type { IntentView } from '../lib/api';
import { formatNairaFromMinor } from '../lib/naira';

interface ConfirmSheetProps {
  intent: IntentView;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/**
 * The Apple-Pay-feel moment. Shows the merchant name from the Xend record and
 * the naira amount from the pinned quote. Never renders an FX rate or a dollar
 * figure. A recognized Session reaches this sheet directly for a one-tap
 * confirm.
 */
export function ConfirmSheet({
  intent,
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmSheetProps) {
  return (
    <div className="bg-brand-black flex h-full flex-col justify-end">
      <div className="border-brand-line bg-brand-surface rounded-t-3xl border-t px-6 pb-8 pt-7">
        <p className="text-brand-muted text-sm">
          Pay {intent.merchantDisplayName}
        </p>
        <p className="text-brand-ink mt-2 text-4xl font-semibold tabular-nums tracking-tight">
          {formatNairaFromMinor(intent.ngnDisplayMinor)}
        </p>

        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="bg-brand-ink text-brand-black mt-8 w-full rounded-2xl py-4 text-base font-semibold disabled:opacity-60"
        >
          {busy ? 'Confirming' : 'Confirm payment'}
        </button>
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
