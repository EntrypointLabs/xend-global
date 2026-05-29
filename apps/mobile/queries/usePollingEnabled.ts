import { useEffect, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns true when the app is foregrounded AND a user is signed in.
 *
 * Phase 7 plugs this into TanStack Query's `enabled` option so wallet polling
 * stops cleanly on background and on logout — never both gates need their own
 * AppState wiring.
 *
 * No precedent for AppState in the repo before this hook; this is the canonical
 * place to add one (subscribe in useEffect, clean up on unmount).
 */
export function usePollingEnabled(): boolean {
  const { user } = useAuth();
  const [isActive, setIsActive] = useState(
    AppState.currentState === "active",
  );

  useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => setIsActive(state === "active"),
    );
    return () => sub.remove();
  }, []);

  return isActive && !!user;
}
