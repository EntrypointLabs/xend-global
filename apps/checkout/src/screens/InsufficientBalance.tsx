interface InsufficientBalanceProps {
  onCancel: () => void;
}

/**
 * Shown when Balance is not enough to complete the Payment. Points the Consumer
 * to the Xend app. No top-up and no KYC live inside the popup.
 */
export function InsufficientBalance({ onCancel }: InsufficientBalanceProps) {
  return (
    <div className="bg-brand-black flex h-full flex-col justify-end">
      <div className="border-brand-line bg-brand-surface rounded-t-3xl border-t px-6 pb-8 pt-7">
        <h1 className="text-brand-ink text-2xl font-semibold tracking-tight">
          Not enough Cash
        </h1>
        <p className="text-brand-muted mt-2 text-sm leading-relaxed">
          Add Cash in the Xend app, then come back to finish paying.
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
