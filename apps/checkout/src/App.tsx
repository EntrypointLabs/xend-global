import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { CheckoutStatus } from '@xend/checkout-protocol';
import { parseLaunch, LaunchError, type Launch } from './lib/launch';
import {
  authorize,
  getIntent,
  isNonPayable,
  CheckoutApiError,
  type IntentView,
} from './lib/api';
import {
  postResultToOpener,
  postCancelToOpener,
} from './messaging/postMessage';
import { completeByRedirect } from './messaging/redirect';
import { LoadingShell } from './screens/LoadingShell';
import { ConfirmSheet } from './screens/ConfirmSheet';
import { InsufficientBalance } from './screens/InsufficientBalance';
import { Result } from './screens/Result';
import type { CeremonyResult } from './ceremony/passkey';

// The real Privy ceremony is enabled with VITE_ENABLE_PRIVY=true. By default the
// build loads a Privy-free stub so the popup bundle carries no Privy web SDK
// (its transitive @solana/kit browser build is currently incompatible with the
// monorepo's Solana packages; tracked as a human integration item). Both screens
// are prop-compatible; the real ceremony stays fully typechecked either way.
const privyEnabled = import.meta.env.VITE_ENABLE_PRIVY === 'true';
const Ceremony = lazy(() =>
  privyEnabled
    ? import('./screens/Ceremony')
    : import('./screens/CeremonyStub'),
);

type Phase =
  | { kind: 'loading' }
  | { kind: 'ceremony'; intent: IntentView }
  | { kind: 'confirm'; intent: IntentView }
  | { kind: 'authorizing'; intent: IntentView }
  | { kind: 'insufficient'; intent: IntentView }
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

    getIntent(reference)
      .then((intent) => {
        if (stale) return;
        if (isNonPayable(intent.status)) {
          deliverResult(intent, intent.status as CheckoutStatus);
          return;
        }
        setPhase(
          intent.sessionRecognized
            ? { kind: 'confirm', intent }
            : { kind: 'ceremony', intent },
        );
      })
      .catch(() => {
        if (!stale) setPhase({ kind: 'fatal' });
      });

    return () => {
      stale = true;
    };
  }, [launch, deliverResult]);

  const runAuthorize = useCallback(
    async (intent: IntentView, providerToken?: string) => {
      if (!launch) return;
      setPhase({ kind: 'authorizing', intent });
      try {
        const result = await authorize({
          reference: intent.reference,
          providerToken,
        });
        deliverResult(intent, result.status, result.redirectUrl);
      } catch (err) {
        if (err instanceof CheckoutApiError) {
          if (err.code === 'INSUFFICIENT_BALANCE') {
            setPhase({ kind: 'insufficient', intent });
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
      }
    },
    [launch, deliverResult],
  );

  switch (phase.kind) {
    case 'fatal':
      return <Result status="failed" />;
    case 'loading':
    case 'authorizing':
      return <LoadingShell />;
    case 'pending':
      return <Result status="succeeded" pending />;
    case 'result':
      return <Result status={phase.status} severed={phase.severed} />;
    case 'insufficient':
      return (
        <InsufficientBalance onCancel={() => deliverCancel(phase.intent)} />
      );
    case 'confirm':
      return (
        <ConfirmSheet
          intent={phase.intent}
          onConfirm={() => runAuthorize(phase.intent)}
          onCancel={() => deliverCancel(phase.intent)}
        />
      );
    case 'ceremony':
      return (
        <Suspense fallback={<LoadingShell />}>
          <Ceremony
            intent={phase.intent}
            onComplete={(result: CeremonyResult) =>
              runAuthorize(phase.intent, result.providerToken)
            }
            onCancel={() => deliverCancel(phase.intent)}
          />
        </Suspense>
      );
  }
}
