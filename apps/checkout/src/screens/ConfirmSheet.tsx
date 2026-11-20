import { useEffect, useState, type MouseEvent } from 'react';
import type { IntentView } from '../lib/api';
import { PaymentSheet } from './PaymentSheet';
import { quoteExpired, useQuoteExpired } from '../lib/useQuoteExpired';
import { CancelButton, ExpiredNotice, PayButton } from './PayButton';

interface ConfirmSheetProps {
  intent: IntentView;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

const ARM_DELAY_MS = 500;

/**
 * The Apple-Pay-feel moment. Shows the merchant name from the Prydd record and
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
      {expired && !busy && <ExpiredNotice />}
      <PayButton
        label={
          busy ? 'Confirming' : expired ? 'Quote expired' : 'Confirm payment'
        }
        busy={busy}
        disabled={busy || !armed || expired}
        onClick={handleConfirm}
      />
      <CancelButton onClick={onCancel} disabled={busy} />
    </PaymentSheet>
  );
}
