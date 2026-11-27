import { useEffect, useRef } from "react";
import { useSegments } from "expo-router";
import { routeToScreenName } from "@prydd/analytics";
import { useAuth } from "@/contexts/AuthContext";
import { analytics } from "@/utils/analytics";

/**
 * Reports screen views and who is signed in. Kept as its own null-rendering
 * component because `useSegments` changes on every navigation, and anything
 * above the screens that read it would re-render the whole app each time.
 */
export function AnalyticsWatch() {
  const segments = useSegments();
  const screen = routeToScreenName(segments as string[]);
  const { user, isAuthenticated } = useAuth();
  const userId: string | undefined = user?.id;
  const wasSignedIn = useRef(false);

  useEffect(() => {
    analytics.screen(screen);
  }, [screen]);

  useEffect(() => {
    if (isAuthenticated && userId) {
      wasSignedIn.current = true;
      analytics.identify(userId);
    } else if (isAuthenticated === false && wasSignedIn.current) {
      wasSignedIn.current = false;
      analytics.track("auth_logged_out", {});
      analytics.reset();
    }
  }, [isAuthenticated, userId]);

  return null;
}
