import type { CheckoutStatus } from '@xend/checkout-protocol';

interface ResultProps {
  status: CheckoutStatus;
  /** Rare server-side confirmation timeout; a neutral receipt-coming state, never an error. */
  pending?: boolean;
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
): {
  title: string;
  detail: string;
} {
  if (pending) {
    return {
      title: 'Payment is processing',
      detail: 'Your receipt is on its way.',
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
      return {
        title: 'Payment canceled',
        detail: 'You can head back to the store.',
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
export function Result({ status, pending = false }: ResultProps) {
  const isSuccess = status === 'succeeded' && !pending;
  const { title, detail } = copyFor(status, pending);

  return (
    <div className="bg-brand-black flex h-full flex-col items-center justify-center px-8 text-center">
      {isSuccess ? <SuccessCheck /> : <NeutralDot />}
      <h1 className="text-brand-ink mt-6 text-xl font-semibold tracking-tight">
        {title}
      </h1>
      <p className="text-brand-muted mt-2 text-sm leading-relaxed">{detail}</p>
    </div>
  );
}
