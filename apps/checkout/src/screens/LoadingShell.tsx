import { StatusSheet } from './StatusSheet';

/**
 * The first paint the popup opens to, rendered synchronously with no Privy
 * import. Also the handshake wait state: when the popup was opened without an
 * intent param, this stays up until the SDK navigation arrives with the intent.
 */
export function LoadingShell() {
  return (
    <StatusSheet>
      <div
        className="payment-result skeleton"
        role="status"
        aria-live="polite"
        aria-label="Preparing your Payment"
      >
        <span className="sk sk-mark" />
        <span className="sk sk-line" />
        <span className="sk sk-total" />
        <span className="sk sk-row" />
        <span className="sk sk-row" />
        <span className="sk sk-cta" />
      </div>
    </StatusSheet>
  );
}
