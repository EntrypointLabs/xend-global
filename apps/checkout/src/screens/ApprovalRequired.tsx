import { useEffect, useState } from 'react';
import { getIntent, type IntentStatus, type IntentView } from '../lib/api';
import { formatMoney } from '../lib/money';
import { MerchantLine } from './PaymentSheet';
import { PayShell } from './StatusSheet';
import { CancelButton } from './PayButton';
import { PhoneGlyph } from './glyphs';

const POLL_MS = 2_000;

type Outcome = Exclude<IntentStatus, 'requires_payment' | 'processing'>;

interface ApprovalRequiredProps {
  intent: IntentView;
  opener: string | null;
  onOutcome: (status: Outcome) => void;
  onCancel: () => void;
}

function useCountdown(expiresAt: string): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Date.parse(expiresAt) - now;
  if (!Number.isFinite(left) || left <= 0) return null;
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1_000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Shown when the Payment is larger than the amount a single confirmation
 * carries, so it needs the second approval that lives on the Consumer's phone.
 * The phone has already been asked; this screen watches the intent and ends by
 * itself the moment the app approves or declines.
 *
 * Deliberately says what to do rather than why: the reason is a signer set, and
 * a shopper at a checkout has no use for that.
 */
export function ApprovalRequired({
  intent,
  opener,
  onOutcome,
  onCancel,
}: ApprovalRequiredProps) {
  const [approved, setApproved] = useState(false);
  const remaining = useCountdown(intent.expiresAt);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const poll = () => {
      getIntent(intent.reference, opener)
        .then((next) => {
          if (stopped) return;
          if (next.status === 'processing') setApproved(true);
          if (
            next.status !== 'requires_payment' &&
            next.status !== 'processing'
          ) {
            onOutcome(next.status);
            return;
          }
          timer = window.setTimeout(poll, POLL_MS);
        })
        .catch(() => {
          if (!stopped) timer = window.setTimeout(poll, POLL_MS * 2);
        });
    };
    timer = window.setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [intent.reference, opener, onOutcome]);

  return (
    <PayShell labelledBy="approval-title">
      <MerchantLine intent={intent} />
      <div className="approval" role="status" aria-live="polite">
        <PhoneGlyph />
        <h1 id="approval-title" className="state-title">
          {approved ? 'Approved. Finishing up' : 'Approve on your phone'}
        </h1>
        <p className="state-detail">
          {approved ? (
            'Hang tight, this takes a few seconds.'
          ) : (
            <>
              We sent{' '}
              <strong className="text-ink font-semibold">
                {formatMoney(intent.displayCurrency, intent.displayAmountMinor)}
              </strong>{' '}
              to your Prydd app for a second check. This page finishes by itself
              once you approve.
            </>
          )}
        </p>
        {!approved && remaining && (
          <p className="countdown">
            Request expires in <span className="tabular-nums">{remaining}</span>
          </p>
        )}
      </div>
      <div className="payment-actions">
        {!approved && (
          <a
            href="https://prydd.co/approve"
            target="_blank"
            rel="noreferrer"
            className="cta cta-quiet"
          >
            No notification? Open Prydd
          </a>
        )}
        <CancelButton onClick={onCancel} disabled={approved} />
      </div>
    </PayShell>
  );
}
