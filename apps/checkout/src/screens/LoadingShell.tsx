import { StatusSheet } from './StatusSheet';

/**
 * The first paint the popup opens to, rendered synchronously with no Privy
 * import. Also the handshake wait state: when the popup was opened without an
 * intent param, this stays up until the SDK navigation arrives with the intent.
 */
export function LoadingShell() {
  return (
    <StatusSheet>
      <div className="payment-result" role="status" aria-live="polite">
        <span className="text-brand-ink text-3xl font-medium tracking-tight">
          Preparing your Payment
        </span>
        <span className="bg-brand-line h-1 w-24 overflow-hidden rounded-full">
          <span className="bg-brand-muted block h-full w-1/2 animate-pulse rounded-full motion-reduce:animate-none" />
        </span>
      </div>
    </StatusSheet>
  );
}
