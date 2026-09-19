import type { ReactNode } from "react";

export function MerchantSessionBoundary({
  ready,
  authenticated,
  accountLoading,
  children,
}: {
  ready: boolean;
  authenticated: boolean;
  accountLoading: boolean;
  children: ReactNode;
}) {
  if (!ready || (authenticated && accountLoading)) {
    return (
      <main
        className="workspace-loading"
        aria-busy="true"
        aria-label="Loading Merchant workspace"
      >
        <p role="status">Loading your dashboard...</p>
      </main>
    );
  }
  return children;
}
