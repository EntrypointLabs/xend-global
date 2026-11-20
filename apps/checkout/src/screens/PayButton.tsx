import type { MouseEvent } from 'react';
import { FaceGlyph, Spinner } from './glyphs';

export function PayButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      className="cta"
    >
      {busy ? <Spinner /> : <FaceGlyph className="h-[1.15rem] w-[1.15rem]" />}
      {label}
    </button>
  );
}

export function CancelButton({
  onClick,
  disabled = false,
  label = 'Cancel',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cancel"
    >
      {label}
    </button>
  );
}

export function ExpiredNotice() {
  return (
    <p role="status" className="notice">
      This quote expired. Return to the store for a new quote.
    </p>
  );
}
