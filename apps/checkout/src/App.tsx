import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { CheckoutStatus } from '@xend/checkout-protocol';
import { parseLaunch, LaunchError, type Launch } from './lib/launch';
import {
  getIntent,
  isNonPayable,
  CheckoutApiError,
  type IntentView,
  type TerminalResult,
} from './lib/api';
import {
  postResultToOpener,
  postCancelToOpener,
} from './messaging/postMessage';
import { completeByRedirect } from './messaging/redirect';
import { LoadingShell } from './screens/LoadingShell';
import { InsufficientBalance } from './screens/InsufficientBalance';
import { Result } from './screens/Result';
import { ApprovalRequired } from './screens/ApprovalRequired';

/*
 * The real passkey flow ships by default; VITE_ENABLE_PRIVY=false loads a
 * Privy-free stub instead, for local UI work without a Privy app to point at.
 *
 * It used to be the other way round, because the Privy web bundle would not
 * build: its transitive @solana-program/token imported a symbol @solana/kit 7
 * had dropped. That skew is gone, and what remained was an uninstalled optional
 * peer (@solana-program/memo), now a real dependency. Opt-out rather than
 * opt-in because the alternative is shipping a checkout that cannot take a
 * payment and finding out in production.
 */
const privyEnabled = import.meta.env.VITE_ENABLE_PRIVY !== 'false';
const PaymentFlow = lazy(() =>
  privyEnabled
    ? import('./screens/PaymentFlow')
    : import('./screens/PaymentFlowStub'),
);

type Phase =
  | { kind: 'loading' }
  | { kind: 'pay'; intent: IntentView }
  | { kind: 'insufficient'; intent: IntentView }
  | { kind: 'approval'; intent: IntentView }
  | { kind: 'pending' }
  | { kind: 'result'; status: CheckoutStatus; severed?: boolean }
  | { kind: 'fatal' };

export function App() {
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  // Parse the launch parameters once. A missing intent is the handshake wait
  // state (LoadingShell), never an error. A missing nonce is fatal.
  useEffect(() => {
    try {
      setLaunch(parseLaunch(window.location.search));
    } catch (err) {
      if (err instanceof LaunchError) setPhase({ kind: 'fatal' });
      else setPhase({ kind: 'fatal' });
    }
  }, []);

  // Deliver a terminal result. Redirect mode navigates to the backend-signed
  // return URL when one exists (a dead intent has none, so it renders in place).
  // Popup mode posts to the exact merchant origin and, if the opener is severed,
  // falls back to a return-to-store state rather than hanging.
  const deliverResult = useCallback(
    (intent: IntentView, status: CheckoutStatus, redirectUrl?: string) => {
      if (!launch) return;
      if (launch.mode === 'redirect') {
        if (redirectUrl) {
          completeByRedirect(redirectUrl);
          return;
        }
        setPhase({ kind: 'result', status });
        return;
      }
      const posted = postResultToOpener(
        intent.merchantOrigin,
        launch.nonce,
        intent.reference,
        status,
      );
      setPhase({ kind: 'result', status, severed: !posted });
    },
    [launch],
  );

  // Deliver a user-initiated cancel. Redirect mode navigates to the signed
  // cancelUrl carried on the intent; if none exists it renders canceled in place.
  const deliverCancel = useCallback(
    (intent: IntentView) => {
      if (!launch) return;
      if (launch.mode === 'redirect') {
        const cancelUrl = intent.cancelUrl;
        if (cancelUrl) {
          completeByRedirect(cancelUrl);
          return;
        }
        setPhase({ kind: 'result', status: 'canceled' });
        return;
      }
      const posted = postCancelToOpener(
        intent.merchantOrigin,
        launch.nonce,
        intent.reference,
      );
      setPhase({ kind: 'result', status: 'canceled', severed: !posted });
    },
    [launch],
  );

  // Fetch the intent once a reference is present.
  useEffect(() => {
    if (!launch || launch.reference === null) return;
    let stale = false;
    const reference = launch.reference;

    getIntent(reference, launch.opener)
      .then((intent) => {
        if (stale) return;
        if (isNonPayable(intent.status)) {
          deliverResult(intent, intent.status as CheckoutStatus);
          return;
        }
        setPhase({ kind: 'pay', intent });
      })
      .catch(() => {
        if (!stale) setPhase({ kind: 'fatal' });
      });

    return () => {
      stale = true;
    };
  }, [launch, deliverResult]);

  /**
   * How a Payment ends. The flow itself lives inside the Privy tree, because
   * signing the Spend needs the provider mounted; App only decides what the
   * Consumer sees when it is over.
   */
  const handleError = useCallback(
    (intent: IntentView, err: unknown) => {
      if (err instanceof CheckoutApiError) {
        if (err.code === 'INSUFFICIENT_BALANCE') {
          setPhase({ kind: 'insufficient', intent });
          return;
        }
        if (err.code === 'APPROVAL_REQUIRED') {
          setPhase({ kind: 'approval', intent });
          return;
        }
        if (err.code === 'INTENT_EXPIRED') {
          deliverResult(intent, 'expired');
          return;
        }
        if (err.code === 'PAYMENT_PROCESSING') {
          setPhase({ kind: 'pending' });
          return;
        }
      }
      deliverResult(intent, 'failed');
    },
    [deliverResult],
  );

  const handleTerminal = useCallback(
    (intent: IntentView, result: TerminalResult) => {
      deliverResult(intent, result.status, result.redirectUrl);
    },
    [deliverResult],
  );

  switch (phase.kind) {
    case 'fatal':
      return <Result status="failed" />;
    case 'loading':
      return <LoadingShell />;
    case 'pending':
      return <Result status="succeeded" pending />;
    case 'result':
      return <Result status={phase.status} severed={phase.severed} />;
    case 'insufficient':
      return (
        <InsufficientBalance onCancel={() => deliverCancel(phase.intent)} />
      );
    case 'approval':
      return (
        <ApprovalRequired
          intent={phase.intent}
          onCancel={() => deliverCancel(phase.intent)}
        />
      );
    case 'pay':
      return (
        <Suspense fallback={<LoadingShell />}>
          <PaymentFlow
            intent={phase.intent}
            onTerminal={(result: TerminalResult) =>
              handleTerminal(phase.intent, result)
            }
            onError={(err: unknown) => handleError(phase.intent, err)}
            onCancel={() => deliverCancel(phase.intent)}
          />
        </Suspense>
      );
  }
}
