import { useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { usePasskeyCeremony, type CeremonyResult } from '../ceremony/passkey';
import { PRIVY_APP_ID } from '../lib/config';
import { formatNairaFromMinor } from '../lib/naira';
import type { IntentView } from '../lib/api';

interface CeremonyProps {
  intent: IntentView;
  onComplete: (result: CeremonyResult) => void;
  onCancel: () => void;
}

function CeremonyInner({ intent, onComplete, onCancel }: CeremonyProps) {
  const { runCeremony } = usePasskeyCeremony();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleContinue = () => {
    setBusy(true);
    setFailed(false);
    // No awaited fetch before runCeremony, which calls loginWithPasskey first.
    runCeremony()
      .then(onComplete)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return (
    <div className="bg-brand-black flex h-full flex-col justify-end">
      <div className="border-brand-line bg-brand-surface rounded-t-3xl border-t px-6 pb-8 pt-7">
        <p className="text-brand-muted text-sm">
          Pay {intent.merchantDisplayName}
        </p>
        <p className="text-brand-ink mt-2 text-4xl font-semibold tabular-nums tracking-tight">
          {formatNairaFromMinor(intent.ngnDisplayMinor)}
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
            onClick={handleContinue}
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
 * The code-split ceremony screen. PrivyProvider and every Privy web SDK import
 * live on this lazily loaded chunk, off the popup-interactive first paint. rp.id
 * is set to xend.global through the Privy app configuration (see the ceremony
 * module).
 */
export default function Ceremony(props: CeremonyProps) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID}>
      <CeremonyInner {...props} />
    </PrivyProvider>
  );
}
