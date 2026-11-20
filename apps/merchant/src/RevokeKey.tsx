import { useRef, useState } from "react";

export function RevokeKey({
  fingerprint,
  onRevoke,
  disabled = false,
  confirming,
  onConfirmingChange,
}: {
  fingerprint: string;
  onRevoke: () => Promise<void>;
  disabled?: boolean;
  /** Lets the parent lay the confirmation out across the whole key row. */
  confirming?: boolean;
  onConfirmingChange?: (confirming: boolean) => void;
}) {
  const [ownConfirming, setOwnConfirming] = useState(false);
  const isConfirming = confirming ?? ownConfirming;
  const setConfirming = onConfirmingChange ?? setOwnConfirming;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function revoke() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await onRevoke();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not revoke this key. Try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return isConfirming ? (
    <div className="key-revoke-confirm">
      <p>
        Revoke {fingerprint}? Integrations using this key will stop working.
        This cannot be undone. Existing Payments are not cancelled.
      </p>
      <div className="actions">
        <button
          type="button"
          className="danger small"
          disabled={busy}
          onClick={() => void revoke()}
        >
          {busy ? "Revoking…" : "Confirm revocation"}
        </button>
        <button
          type="button"
          className="secondary small"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            setError("");
          }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  ) : (
    <button
      type="button"
      className="quiet small"
      aria-label={`Revoke key ${fingerprint}`}
      disabled={disabled}
      onClick={() => setConfirming(true)}
    >
      Revoke
    </button>
  );
}
