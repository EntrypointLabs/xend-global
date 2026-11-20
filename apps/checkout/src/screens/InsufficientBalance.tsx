import { StatusSheet } from './StatusSheet';
import { CancelButton } from './PayButton';

interface InsufficientBalanceProps {
  onCancel: () => void;
}

/**
 * Shown when Balance is not enough to complete the Payment. Points the Consumer
 * to the Prydd app. No top-up and no KYC live inside the popup.
 */
export function InsufficientBalance({ onCancel }: InsufficientBalanceProps) {
  return (
    <StatusSheet>
      <div className="payment-result" role="status">
        <h1 className="state-title">Not enough Cash</h1>
        <p className="state-detail">
          Add Cash in the Prydd app, then come back to finish paying. You have
          not been charged.
        </p>
      </div>
      <div className="payment-actions">
        <a href="https://prydd.co" className="cta">
          Open Prydd
        </a>
        <CancelButton onClick={onCancel} />
      </div>
    </StatusSheet>
  );
}
