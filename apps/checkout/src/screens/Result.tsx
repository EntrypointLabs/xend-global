import type { CheckoutStatus } from '@xend/checkout-protocol';
import { StatusSheet } from './StatusSheet';

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

function SuccessCheck() {
  // The only green on the surface, reserved for the passkey success checkmark.
  return (
    <span className="border-success flex h-16 w-16 items-center justify-center rounded-full border-2">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="text-success h-8 w-8"
        aria-hidden="true"
      >
        <path
          d="M5 13l4 4L19 7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function NeutralDot() {
  return (
    <span className="border-brand-line bg-brand-surface flex h-16 w-16 items-center justify-center rounded-full border-2">
      <span className="bg-brand-muted h-2.5 w-2.5 rounded-full" />
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
        'Your Payment is still being confirmed. Check Activity in Xend before trying again.',
    };
  }
  switch (status) {
    case 'succeeded':
      return {
        title: 'Payment complete',
        detail: 'Your receipt is on its way.',
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
        {isSuccess ? <SuccessCheck /> : <NeutralDot />}
        <h1 className="text-brand-ink mt-6 text-xl font-semibold tracking-tight">
          {base.title}
        </h1>
        <p className="text-brand-muted mt-2 text-sm leading-relaxed">
          {detail}
        </p>
      </div>
    </StatusSheet>
  );
}
