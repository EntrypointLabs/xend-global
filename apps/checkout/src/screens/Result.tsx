import type { CheckoutStatus } from '@prydd/checkout-protocol';
import { StatusSheet } from './StatusSheet';
import { DoneCheck } from './glyphs';

interface ResultProps {
  status: CheckoutStatus;
  /** Rare server-side confirmation timeout; a neutral receipt-coming state, never an error. */
  pending?: boolean;
  /** Popup opener was severed (COOP); guide the Consumer back to the store instead of hanging. */
  severed?: boolean;
  /** The status is the intent's own backend outcome, not a dismissed attempt. A
   * terminal `canceled` was voided by the merchant and cannot be paid again. */
  terminal?: boolean;
}

function NeutralDot() {
  return (
    <span className="neutral-mark" aria-hidden="true">
      <span />
    </span>
  );
}

function copyFor(
  status: CheckoutStatus,
  pending: boolean,
  terminal: boolean,
): {
  title: string;
  detail: string;
} {
  if (pending) {
    return {
      title: 'Waiting for confirmation',
      detail:
        'Your Payment is still being confirmed. Check Activity in Prydd before trying again.',
    };
  }
  switch (status) {
    case 'succeeded':
      return {
        title: 'Done',
        detail: 'Payment complete. Your receipt is on its way.',
      };
    case 'expired':
      return {
        title: 'This payment link is no longer active',
        detail: 'Head back to the store to start again.',
      };
    case 'canceled':
      // A terminal canceled status is the intent's own backend state: the
      // merchant voided this order, so returning to the store will not let the
      // Consumer pay it again. A non-terminal canceled is this attempt being
      // dismissed; the intent stays payable, so inviting a retry is correct.
      return terminal
        ? {
            title: 'This order was canceled',
            detail:
              'The store canceled this order. Contact the store if you still want to pay.',
          }
        : {
            title: 'Checkout canceled',
            detail:
              'This attempt was canceled. Head back to the store to try again.',
          };
    case 'failed':
    default:
      return {
        title: 'Payment could not be completed',
        detail: 'Head back to the store to try again.',
      };
  }
}

/**
 * Terminal state. Success shows the green checkmark; every other outcome is
 * neutral. Copy says receipt, never a transaction reference.
 */
export function Result({
  status,
  pending = false,
  severed = false,
  terminal = false,
}: ResultProps) {
  const isSuccess = status === 'succeeded' && !pending;
  const base = copyFor(status, pending, terminal);
  const detail = severed ? 'You can head back to the store.' : base.detail;

  return (
    <StatusSheet>
      <div className="payment-result" role="status" aria-live="polite">
        {isSuccess ? <DoneCheck /> : <NeutralDot />}
        <h1 className="state-title">{base.title}</h1>
        <p className="state-detail">{detail}</p>
      </div>
    </StatusSheet>
  );
}
