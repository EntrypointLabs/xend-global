import { useState } from "react";

export function KeyReveal({
  secret,
  onDismiss,
  label,
}: {
  secret: string;
  onDismiss: () => void;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setStatus("Key copied. Store it securely on your server.");
    } catch {
      setStatus("Clipboard access was denied. Select and copy the key above.");
    }
  }
  return (
    <div className="key-reveal">
      <strong>
        {label ? `${label}. ` : ""}Copy this now. It is shown only once.
      </strong>
      <code>{secret}</code>
      <p>
        Keep this secret on your server. Never include it in browser code or a
        public repository.
      </p>
      <button className="secondary" onClick={() => void copy()}>
        Copy key
      </button>
      <button className="quiet" onClick={onDismiss}>
        Dismiss
      </button>
      <p role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
