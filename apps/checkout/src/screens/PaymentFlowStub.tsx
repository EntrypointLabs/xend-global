import { formatMoney } from '../lib/money';
import type { PaymentFlowProps } from './PaymentFlow';

/**
 * Privy-free stand-in for the payment flow, used when the build is compiled
 * without VITE_ENABLE_PRIVY. Prop-compatible with the real one
 * (screens/PaymentFlow) so App wires either interchangeably. Production builds
 * set VITE_ENABLE_PRIVY=true to load the real Privy flow once the Privy web
 * bundle is integrated.
 */
export default function PaymentFlowStub({
  intent,
  onCancel,
}: PaymentFlowProps) {
  return (
    <div className="bg-brand-black flex h-full flex-col justify-end">
      <div className="border-brand-line bg-brand-surface rounded-t-3xl border-t px-6 pb-8 pt-7">
        <p className="text-brand-muted text-sm">
          Pay {intent.merchantDisplayName}
        </p>
        <p className="text-brand-ink mt-2 text-4xl font-semibold tabular-nums tracking-tight">
          {formatMoney(intent.displayCurrency, intent.displayAmountMinor)}
        </p>
        <p className="text-brand-muted mt-6 text-sm leading-relaxed">
          Passkey sign-in is being set up for this build. Please open the Xend
          app to complete your payment.
        </p>
        <a
          href="https://xend.global/app"
          className="bg-brand-ink text-brand-black mt-6 block w-full rounded-2xl py-4 text-center text-base font-semibold"
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
