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
  | { kind: 'result'; status: CheckoutStatus }
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

  // Fetch the intent once a reference is present.
  useEffect(() => {
    if (!launch || launch.reference === null) return;
    let stale = false;
    const { nonce, reference } = launch;

    getIntent(reference)
      .then((intent) => {
        if (stale) return;
        if (isNonPayable(intent.status)) {
          const status = intent.status as CheckoutStatus;
          postResultToOpener(intent.merchantOrigin, nonce, reference, status);
          setPhase({ kind: 'result', status });
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
  }, [launch]);

  const runAuthorize = useCallback(
    async (intent: IntentView, providerToken?: string) => {
      if (!launch) return;
      const { nonce } = launch;
      const reference = intent.reference;
      const origin = intent.merchantOrigin;
      setPhase({ kind: 'authorizing', intent });
      try {
        const result = await authorize({ reference, providerToken });
        postResultToOpener(origin, nonce, reference, result.status);
        setPhase({ kind: 'result', status: result.status });
      } catch (err) {
        if (err instanceof CheckoutApiError) {
          if (err.code === 'INSUFFICIENT_BALANCE') {
            setPhase({ kind: 'insufficient', intent });
            return;
          }
          if (err.code === 'INTENT_EXPIRED') {
            postResultToOpener(origin, nonce, reference, 'expired');
            setPhase({ kind: 'result', status: 'expired' });
            return;
          }
          if (err.code === 'PAYMENT_PROCESSING') {
            setPhase({ kind: 'pending' });
            return;
          }
        }
        postResultToOpener(origin, nonce, reference, 'failed');
        setPhase({ kind: 'result', status: 'failed' });
      }
    },
    [launch],
  );

  const cancel = useCallback(
    (intent: IntentView) => {
      if (launch) {
        postCancelToOpener(
          intent.merchantOrigin,
          launch.nonce,
          intent.reference,
        );
      }
      setPhase({ kind: 'result', status: 'canceled' });
    },
    [launch],
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
      return <Result status={phase.status} />;
    case 'insufficient':
      return <InsufficientBalance onCancel={() => cancel(phase.intent)} />;
    case 'confirm':
      return (
        <ConfirmSheet
          intent={phase.intent}
          onConfirm={() => runAuthorize(phase.intent)}
          onCancel={() => cancel(phase.intent)}
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
            onCancel={() => cancel(phase.intent)}
          />
        </Suspense>
      );
  }
}
