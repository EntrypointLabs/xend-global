import { useCallback, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { usePasskeyCeremony } from '../ceremony/passkey';
import { PRIVY_APP_ID } from '../lib/config';
import { formatMoney } from '../lib/money';
import {
  authorize,
  settle,
  type IntentView,
  type TerminalResult,
} from '../lib/api';
import { ConfirmSheet } from './ConfirmSheet';

export interface PaymentFlowProps {
  intent: IntentView;
  onTerminal: (result: TerminalResult) => void;
  onError: (err: unknown) => void;
  onCancel: () => void;
}

function PaymentFlowInner({
  intent,
  onTerminal,
  onError,
  onCancel,
}: PaymentFlowProps) {
  const { runCeremony, signSpend } = usePasskeyCeremony();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * The whole Payment, in the order the security model requires: prove who the
   * Consumer is, get the Spend the backend built out of their Account, sign it
   * with the Account's own signer, hand the bytes back.
   *
   * A recognised Session skips the passkey prompt for the first step but not
   * the second: recognition is not a signature, and the money does not move
   * without one.
   */
  const run = useCallback(() => {
    setBusy(true);
    setFailed(false);
    // No awaited fetch before the ceremony call, so Safari user activation holds.
    const credential = intent.sessionRecognized
      ? Promise.resolve(undefined)
      : runCeremony().then((result) => result.providerToken);

    credential
      .then((providerToken) =>
        authorize({ reference: intent.reference, providerToken }),
      )
      .then(async (result) => {
        if (result.status !== 'needs_signature') {
          onTerminal(result);
          return;
        }
        const signedTxBase64 = await signSpend(
          result.unsignedTxBase64,
          result.signerAddress,
        );
        onTerminal(
          await settle({ reference: intent.reference, signedTxBase64 }),
        );
      })
      .catch((err: unknown) => {
        setFailed(true);
        onError(err);
      })
      .finally(() => setBusy(false));
  }, [intent, runCeremony, signSpend, onTerminal, onError]);

  if (intent.sessionRecognized) {
    return (
      <ConfirmSheet
        intent={intent}
        onConfirm={run}
        onCancel={onCancel}
        busy={busy}
      />
    );
  }

  return (
    <div className="bg-brand-black flex h-full flex-col justify-end">
      <div className="border-brand-line bg-brand-surface rounded-t-3xl border-t px-6 pb-8 pt-7">
        <p className="text-brand-muted text-sm">
          Pay {intent.merchantDisplayName}
        </p>
        <p className="text-brand-ink mt-2 text-4xl font-semibold tabular-nums tracking-tight">
          {formatMoney(intent.displayCurrency, intent.displayAmountMinor)}
        </p>

        {failed ? (
          <>
            <p className="text-brand-muted mt-6 text-sm leading-relaxed">
              That did not go through. Reload and try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="bg-brand-ink text-brand-black mt-4 w-full rounded-2xl py-4 text-base font-semibold"
            >
              Try again
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="bg-brand-ink text-brand-black mt-8 w-full rounded-2xl py-4 text-base font-semibold disabled:opacity-60"
          >
            {busy
              ? 'Waiting for confirmation'
              : 'Continue with Face ID or fingerprint'}
          </button>
        )}

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

/**
 * The code-split payment screen. PrivyProvider and every Privy web SDK import
 * live on this lazily loaded chunk, off the popup-interactive first paint. rp.id
 * is set to xend.global through the Privy app configuration (see the ceremony
 * module).
 *
 * The whole Payment runs inside this tree rather than in App, because signing
 * the Spend needs the provider mounted just as much as the passkey prompt does.
 */
export default function PaymentFlow(props: PaymentFlowProps) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID}>
      <PaymentFlowInner {...props} />
    </PrivyProvider>
  );
}
