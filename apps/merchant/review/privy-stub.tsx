import type { ReactNode } from "react";
import { installReviewFixtures, reviewState } from "./fixtures";

// Review mode only (vite --mode review): stands in for Privy so every portal
// route can be inspected with fixture data and no real sign-in.
installReviewFixtures();

const state = reviewState();
const signedIn = state !== "signedout";

export function PrivyProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function usePrivy() {
  return {
    ready: true,
    authenticated: signedIn,
    user: signedIn ? { id: "review-user" } : null,
    login: () => {
      window.location.search = "?state=new";
    },
    logout: async () => {
      window.location.search = "?state=signedout";
    },
  };
}

export function useIdentityToken() {
  return { identityToken: signedIn ? "review-token" : null };
}
