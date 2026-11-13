import { useEffect, useState, type MouseEvent } from 'react';
import type { IntentView } from '../lib/api';
import { PaymentSheet } from './PaymentSheet';
import { quoteExpired, useQuoteExpired } from '../lib/useQuoteExpired';

interface ConfirmSheetProps {
  intent: IntentView;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

const ARM_DELAY_MS = 500;

/**
 * The Apple-Pay-feel moment. Shows the merchant name from the Xend record and
 * the price and exact USDC debit from the pinned quote.
 * A recognized Session reaches this sheet directly for a one-tap
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
  const expired = useQuoteExpired(intent.expiresAt);

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
    if (!armed || busy || quoteExpired(intent.expiresAt)) return;
    onConfirm();
  };

  return (
    <PaymentSheet intent={intent}>
      {expired && !busy && (
        <p role="status" className="text-brand-muted text-sm">
          This quote expired. Return to the store for a new quote.
        </p>
      )}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={busy || !armed || expired}
        className="bg-brand-ink text-brand-black mt-8 w-full rounded-2xl py-4 text-base font-semibold disabled:opacity-60"
      >
        {busy ? 'Confirming' : expired ? 'Quote expired' : 'Confirm payment'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="text-brand-muted mt-2 w-full py-3 text-sm disabled:opacity-50"
      >
        Cancel
      </button>
    </PaymentSheet>
  );
}
