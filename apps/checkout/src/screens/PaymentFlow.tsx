import { useCallback, useRef, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { usePasskeyCeremony } from '../ceremony/passkey';
import { PRIVY_APP_ID } from '../lib/config';
import { solanaRpcs } from '../lib/solana';
import {
  authorize,
  settle,
  type IntentView,
  type TerminalResult,
} from '../lib/api';
import { ConfirmSheet } from './ConfirmSheet';
import { PaymentSheet } from './PaymentSheet';
import { quoteExpired, useQuoteExpired } from '../lib/useQuoteExpired';

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
  const inFlight = useRef(false);
  const expired = useQuoteExpired(intent.expiresAt);

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
    if (inFlight.current || quoteExpired(intent.expiresAt)) return;
    inFlight.current = true;
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
          result.executionCluster,
        );
        onTerminal(
          await settle({ reference: intent.reference, signedTxBase64 }),
        );
      })
      .catch((err: unknown) => {
        setFailed(true);
        onError(err);
      })
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
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
    <PaymentSheet intent={intent}>
      {expired && !busy && (
        <p role="status" className="text-brand-muted text-sm">
          This quote expired. Return to the store for a new quote.
        </p>
      )}
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
          disabled={busy || expired}
          className="bg-brand-ink text-brand-black mt-8 w-full rounded-2xl py-4 text-base font-semibold disabled:opacity-60"
        >
          {busy
            ? 'Waiting for confirmation'
            : expired
              ? 'Quote expired'
              : 'Pay with passkey'}
        </button>
      )}

      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="text-brand-muted mt-2 w-full py-3 text-sm disabled:opacity-50"
      >
        Cancel
      </button>
    </PaymentSheet>
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
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{ solana: { rpcs: solanaRpcs } }}
    >
      <PaymentFlowInner {...props} />
    </PrivyProvider>
  );
}
