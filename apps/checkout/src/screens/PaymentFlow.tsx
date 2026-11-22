import { useCallback, useEffect, useRef, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { usePasskeyCeremony } from '../ceremony/passkey';
import { PRIVY_APP_ID } from '../lib/config';
import { solanaRpcs } from '../lib/solana';
import {
  authorize,
  CheckoutApiError,
  settle,
  settleUntilTerminal,
  type IntentView,
  type TerminalResult,
} from '../lib/api';
import { ConfirmSheet } from './ConfirmSheet';
import { CancelButton, ExpiredNotice, PayButton } from './PayButton';
import { PaymentSheet } from './PaymentSheet';
import { quoteExpired, useQuoteExpired } from '../lib/useQuoteExpired';

export interface PaymentFlowProps {
  intent: IntentView;
  onTerminal: (result: TerminalResult) => void;
  onError: (err: unknown) => void;
  onCancel: () => void;
  waitForTerminal?: boolean;
}

function PaymentFlowInner({
  intent,
  onTerminal,
  onError,
  onCancel,
  waitForTerminal = false,
}: PaymentFlowProps) {
  const { runCeremony, signSpend, forgetIdentity } = usePasskeyCeremony();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [wrongPasskey, setWrongPasskey] = useState(false);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const expired = useQuoteExpired(intent.expiresAt);

  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  /**
   * The whole Payment, in the order the security model requires: prove who the
   * Consumer is, get the Spend the backend built out of their Account, sign it
   * with the Account's own signer, hand the bytes back.
   *
   * A recognised Session only shortens the sheet; the passkey is presented on
   * every tap, because recognition is not a signature and the money does not
   * move without one.
   */
  const run = useCallback(() => {
    if (inFlight.current || quoteExpired(intent.expiresAt)) return;
    inFlight.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setFailed(false);
    setWrongPasskey(false);
    // No awaited fetch before the ceremony call, so Safari user activation holds.
    // A recognised Session runs it too, and sends the identity it proves: the
    // backend then authorizes whoever owns the passkey just chosen, not the
    // Session's Consumer, so a different or unfinished identity is caught.
    const credential = runCeremony().then((result) => result.providerToken);

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
        const input = { reference: intent.reference, signedTxBase64 };
        onTerminal(
          waitForTerminal
            ? await settleUntilTerminal(input, { signal: controller.signal })
            : await settle(input, controller.signal),
        );
      })
      .catch(async (err: unknown) => {
        if (controller.signal.aborted) return;
        if (
          err instanceof CheckoutApiError &&
          err.code === 'UNKNOWN_CONSUMER'
        ) {
          // Nothing was charged and the intent is still payable: let the
          // shopper pick another passkey here instead of ending the checkout.
          await forgetIdentity().catch(() => undefined);
          setWrongPasskey(true);
          return;
        }
        setFailed(true);
        onError(err);
      })
      .finally(() => {
        if (abort.current === controller) abort.current = null;
        inFlight.current = false;
        setBusy(false);
      });
  }, [
    intent,
    runCeremony,
    signSpend,
    forgetIdentity,
    onTerminal,
    onError,
    waitForTerminal,
  ]);

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
      {expired && !busy && <ExpiredNotice />}
      {wrongPasskey && !busy && (
        <p role="alert" className="notice">
          That passkey isn&rsquo;t linked to a Prydd account. Try again and
          choose the one you use in the Prydd app.
        </p>
      )}
      {failed ? (
        <>
          <p role="alert" className="notice">
            That did not go through. Try again in a moment.
          </p>
          <PayButton
            label="Try again"
            busy={false}
            disabled={false}
            onClick={() => window.location.reload()}
          />
        </>
      ) : (
        <PayButton
          label={
            busy
              ? 'Waiting for passkey'
              : expired
                ? 'Quote expired'
                : 'Pay with passkey'
          }
          busy={busy}
          disabled={busy || expired}
          onClick={run}
        />
      )}
      <CancelButton onClick={onCancel} disabled={busy} />
    </PaymentSheet>
  );
}

/**
 * The code-split payment screen. PrivyProvider and every Privy web SDK import
 * live on this lazily loaded chunk, off the popup-interactive first paint. rp.id
 * is set to prydd.co through the Privy app configuration (see the ceremony
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
