import type { ReactNode } from 'react';
import { LockGlyph, PassageMark } from './glyphs';

function SheetHead() {
  return (
    <header className="sheet-head">
      <span className="brand">
        <PassageMark className="brand-mark" />
        Prydd
      </span>
    </header>
  );
}

export function SheetFoot() {
  return (
    <footer className="sheet-foot">
      <LockGlyph className="h-3 w-3" />
      Your passkey never leaves your device
    </footer>
  );
}

/** Stable Checkout chrome while the payment changes state. */
export function StatusSheet({ children }: { children: ReactNode }) {
  return (
    <main className="payment-stage">
      <section className="payment-sheet" aria-label="Prydd Checkout">
        <SheetHead />
        <div className="payment-state">{children}</div>
      </section>
    </main>
  );
}

export function PayShell({
  labelledBy,
  children,
}: {
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <main className="payment-stage">
      <section className="payment-sheet" aria-labelledby={labelledBy}>
        <SheetHead />
        {children}
        <SheetFoot />
      </section>
    </main>
  );
}
