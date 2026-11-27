import { useState } from "react";
import { Icon } from "./ui";

export function KeyReveal({
  secret,
  onDismiss,
  onCopied,
  label,
}: {
  secret: string;
  onDismiss: () => void;
  onCopied?: () => void;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setStatus("Key copied. Store it securely on your server.");
      onCopied?.();
    } catch {
      setStatus("Clipboard access was denied. Select and copy the key above.");
    }
  }
  return (
    <div className="secret-reveal">
      <strong>
        <Icon name="key" />
        {label ? `${label}. ` : ""}Copy this now. It is shown only once.
      </strong>
      <code>{secret}</code>
      <p>
        Keep this secret on your server. Never include it in browser code or a
        public repository.
      </p>
      <div className="actions">
        <button className="small" onClick={() => void copy()}>
          <Icon name="copy" size={15} />
          Copy key
        </button>
        <button className="quiet small" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <p role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
