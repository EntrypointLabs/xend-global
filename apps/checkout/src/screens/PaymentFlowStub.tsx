import { PaymentSheet } from './PaymentSheet';
import type { PaymentFlowProps } from './PaymentFlow';

/**
 * Privy-free stand-in for the payment flow, used when the build is compiled
 * with VITE_ENABLE_PRIVY=false. Never simulates a successful Payment.
 */
export default function PaymentFlowStub({
  intent,
  onCancel,
}: PaymentFlowProps) {
  return (
    <PaymentSheet intent={intent}>
      <p className="text-brand-muted mt-6 text-sm leading-relaxed">
        Payment approval is disabled in this development build. No Payment has
        been submitted. Return to the store and use a signing-enabled build.
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="text-brand-muted mt-2 w-full py-3 text-sm"
      >
        Cancel
      </button>
    </PaymentSheet>
  );
}
