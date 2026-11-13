import type { ReactNode } from 'react';

/** Stable Checkout chrome while the payment changes state. */
export function StatusSheet({ children }: { children: ReactNode }) {
  return (
    <main className="payment-stage">
      <section className="payment-sheet" aria-label="Xend Checkout">
        <header className="payment-header">
          <span className="payment-wordmark">Xend</span>
          <span className="payment-header-label">Checkout</span>
        </header>
        <div className="payment-state">{children}</div>
      </section>
    </main>
  );
}
