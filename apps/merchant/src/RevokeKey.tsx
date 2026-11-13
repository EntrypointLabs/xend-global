import { useRef, useState } from "react";

export function RevokeKey({
  fingerprint,
  onRevoke,
  disabled = false,
}: {
  fingerprint: string;
  onRevoke: () => Promise<void>;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
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

  return (
    <div className="key-revoke">
      {confirming ? (
        <>
          <p>
            Revoke {fingerprint}? Integrations using this key will stop working.
            This cannot be undone. Existing Payments are not cancelled.
          </p>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void revoke()}>
              {busy ? "Revoking…" : "Confirm revocation"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </>
      ) : (
        <button
          type="button"
          className="secondary"
          aria-label={`Revoke key ${fingerprint}`}
          disabled={disabled}
          onClick={() => setConfirming(true)}
        >
          Revoke key
        </button>
      )}
    </div>
  );
}
