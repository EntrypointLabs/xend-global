import type { ReactNode } from "react";
import { Mark } from "./ui";

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
        <Mark size={28} />
        <p role="status">Loading your dashboard...</p>
      </main>
    );
  }
  return children;
}
