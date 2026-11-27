import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { CheckoutStatus } from '@prydd/checkout-protocol';
import { parseLaunch, LaunchError, type Launch } from './lib/launch';
import {
  getIntent,
  isNonPayable,
  CheckoutApiError,
  type IntentView,
  type TerminalResult,
} from './lib/api';
import {
  postReadyToMerchant,
  postResultToMerchant,
  postCancelToMerchant,
  postUnresolvedToMerchant,
} from './messaging/postMessage';
import { completeByRedirect } from './messaging/redirect';
import { LoadingShell } from './screens/LoadingShell';
import { InsufficientBalance } from './screens/InsufficientBalance';
import { Result } from './screens/Result';
import { ApprovalRequired } from './screens/ApprovalRequired';
import { errorReason, routeToScreenName } from '@prydd/analytics';
import { analytics, intentAmountBucket } from './lib/analytics';
import { isFramed } from './lib/frame';

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
  | {
      kind: 'result';
      status: CheckoutStatus;
      severed?: boolean;
      /** The status is the intent's own backend outcome, not a dismissed
       * attempt: a canceled intent was voided by the merchant and cannot be
       * paid by returning to the store. */
      terminal?: boolean;
    }
  | { kind: 'fatal' };

export function App() {
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  // Parse the launch parameters once. A missing intent is the handshake wait
  // state (LoadingShell), never an error. A missing nonce is fatal.
  useEffect(() => {
    try {
      const parsed = parseLaunch(window.location.search);
      setLaunch(parsed);
      analytics.track('checkout_opened', {
        mode: isFramed()
          ? 'iframe'
          : parsed.mode === 'iframe'
            ? 'direct'
            : parsed.mode,
      });
    } catch (err) {
      analytics.track('checkout_failed', {
        reason: errorReason(err),
        stage: 'launch',
      });
      if (err instanceof LaunchError) setPhase({ kind: 'fatal' });
      else setPhase({ kind: 'fatal' });
    }
  }, []);

  useEffect(() => {
    analytics.screen(routeToScreenName(['checkout', phase.kind]));
  }, [phase.kind]);

  // Announce the surface to the merchant page as soon as the launch parses,
  // before the intent is fetched. Without a named opener there is no exact
  // origin to post to, and a wildcard target is never an option.
  useEffect(() => {
    if (!launch || launch.mode === 'redirect' || !launch.opener) return;
    postReadyToMerchant(launch.opener, launch.nonce);
  }, [launch]);

  // Deliver a terminal result. Redirect mode navigates to the backend-signed
  // return URL when one exists (a dead intent has none, so it renders in place).
  // Popup and iframe mode post to the exact merchant origin and, if that channel
  // is gone, fall back to a return-to-store state rather than hanging.
  const deliverResult = useCallback(
    (intent: IntentView, status: CheckoutStatus, redirectUrl?: string) => {
      if (!launch) return;
      if (launch.mode === 'redirect') {
        if (redirectUrl) {
          completeByRedirect(redirectUrl);
          return;
        }
        setPhase({ kind: 'result', status, terminal: true });
        return;
      }
      const posted = postResultToMerchant(
        intent.merchantOrigin,
        launch.nonce,
        intent.reference,
        status,
      );
      setPhase({ kind: 'result', status, severed: !posted, terminal: true });
    },
    [launch],
  );

  // Deliver a user-initiated cancel. Redirect mode navigates to the signed
  // cancelUrl carried on the intent; if none exists it renders canceled in place.
  const deliverCancel = useCallback(
    (intent: IntentView, stage: string) => {
      if (!launch) return;
      analytics.track('checkout_cancelled', { stage });
      if (launch.mode === 'redirect') {
        const cancelUrl = intent.cancelUrl;
        if (cancelUrl) {
          completeByRedirect(cancelUrl);
          return;
        }
        setPhase({ kind: 'result', status: 'canceled' });
        return;
      }
      const posted = postCancelToMerchant(
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
          if (intent.status !== 'succeeded') {
            analytics.track('checkout_failed', {
              reason: `intent_${intent.status}`,
              stage: 'load',
            });
          }
          deliverResult(intent, intent.status as CheckoutStatus);
          return;
        }
        if (intent.awaitingApproval) {
          analytics.track('checkout_approval_required', {});
        } else {
          analytics.track('checkout_quote_shown', {
            token: 'USDC',
            amount_bucket: intentAmountBucket(intent),
          });
        }
        setPhase(
          intent.awaitingApproval
            ? { kind: 'approval', intent }
            : { kind: 'pay', intent },
        );
      })
      .catch((err: unknown) => {
        if (stale) return;
        analytics.track('checkout_failed', {
          reason: errorReason(err),
          stage: 'load',
        });
        setPhase({ kind: 'fatal' });
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
          analytics.track('checkout_insufficient_balance', {
            amount_bucket: intentAmountBucket(intent),
          });
          setPhase({ kind: 'insufficient', intent });
          return;
        }
        if (err.code === 'APPROVAL_REQUIRED') {
          analytics.track('checkout_approval_required', {});
          setPhase({ kind: 'approval', intent });
          return;
        }
        if (err.code === 'INTENT_EXPIRED') {
          analytics.track('checkout_failed', {
            reason: errorReason(err),
            stage: 'pay',
          });
          deliverResult(intent, 'expired');
          return;
        }
        if (err.code === 'PAYMENT_PROCESSING') {
          if (launch && launch.mode !== 'redirect') {
            postUnresolvedToMerchant(
              intent.merchantOrigin,
              launch.nonce,
              intent.reference,
            );
          }
          setPhase({ kind: 'pending' });
          return;
        }
      }
      analytics.track('checkout_failed', {
        reason: errorReason(err),
        stage: 'pay',
      });
      deliverResult(intent, 'failed');
    },
    [deliverResult, launch],
  );

  const handleTerminal = useCallback(
    (intent: IntentView, result: TerminalResult) => {
      if (result.status === 'succeeded') {
        analytics.track('checkout_paid', {
          amount_bucket: intentAmountBucket(intent),
        });
      } else {
        analytics.track('checkout_failed', {
          reason: 'payment_failed',
          stage: 'settle',
        });
      }
      deliverResult(intent, result.status, result.redirectUrl);
    },
    [deliverResult],
  );

  const approvalIntent = phase.kind === 'approval' ? phase.intent : null;
  const handleApprovalOutcome = useCallback(
    (status: CheckoutStatus) => {
      if (!approvalIntent) return;
      if (status === 'succeeded') {
        analytics.track('checkout_paid', {
          amount_bucket: intentAmountBucket(approvalIntent),
        });
      } else {
        analytics.track('checkout_failed', {
          reason: `intent_${status}`,
          stage: 'approval',
        });
      }
      deliverResult(approvalIntent, status);
    },
    [approvalIntent, deliverResult],
  );

  switch (phase.kind) {
    case 'fatal':
      return <Result status="failed" />;
    case 'loading':
      return <LoadingShell />;
    case 'pending':
      return <Result status="succeeded" pending />;
    case 'result':
      return (
        <Result
          status={phase.status}
          severed={phase.severed}
          terminal={phase.terminal}
        />
      );
    case 'insufficient':
      return (
        <InsufficientBalance
          onCancel={() => deliverCancel(phase.intent, 'insufficient')}
        />
      );
    case 'approval':
      return (
        <ApprovalRequired
          intent={phase.intent}
          opener={launch?.opener ?? null}
          onOutcome={handleApprovalOutcome}
          onCancel={() => deliverCancel(phase.intent, 'approval')}
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
            onCancel={() => deliverCancel(phase.intent, 'pay')}
            waitForTerminal={launch?.mode === 'redirect'}
          />
        </Suspense>
      );
  }
}
