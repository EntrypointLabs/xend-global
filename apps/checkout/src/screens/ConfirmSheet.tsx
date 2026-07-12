import { useEffect, useState, type MouseEvent } from 'react';
import type { IntentView } from '../lib/api';
import { formatNairaFromMinor } from '../lib/naira';

interface ConfirmSheetProps {
  intent: IntentView;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

const ARM_DELAY_MS = 500;

/**
 * The Apple-Pay-feel moment. Shows the merchant name from the Xend record and
 * the naira amount from the pinned quote. Never renders an FX rate or a dollar
 * figure. A recognized Session reaches this sheet directly for a one-tap
 * confirm.
 *
 * The confirm button arms only after a short delay AND an observed interaction,
 * and ignores untrusted (synthetic) clicks, to close the DoubleClickjacking
 * vector. Cancel needs no arming.
 */
export function ConfirmSheet({
  intent,
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmSheetProps) {
  const [delayPassed, setDelayPassed] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const armed = delayPassed && interacted;

  useEffect(() => {
    const timer = window.setTimeout(() => setDelayPassed(true), ARM_DELAY_MS);
    const onInteract = () => setInteracted(true);
    const opts: AddEventListenerOptions = { once: true, passive: true };
    window.addEventListener('pointermove', onInteract, opts);
    window.addEventListener('pointerdown', onInteract, opts);
    window.addEventListener('scroll', onInteract, opts);
    window.addEventListener('touchstart', onInteract, opts);
    window.addEventListener('keydown', onInteract, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onInteract);
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('scroll', onInteract);
      window.removeEventListener('touchstart', onInteract);
      window.removeEventListener('keydown', onInteract);
    };
  }, []);

  const handleConfirm = (event: MouseEvent<HTMLButtonElement>) => {
    if (!event.isTrusted) return;
    if (!armed || busy) return;
    onConfirm();
  };

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
          onClick={handleConfirm}
          disabled={busy || !armed}
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
