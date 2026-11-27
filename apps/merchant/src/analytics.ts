import { errorReason } from "@prydd/analytics";
import { createWebAnalytics } from "@prydd/analytics/web";

export { routeToScreenName } from "@prydd/analytics";

export const analytics = createWebAnalytics({
  app: "merchant",
  apiKey: import.meta.env.VITE_POSTHOG_KEY,
  apiHost: import.meta.env.VITE_POSTHOG_HOST || undefined,
  debug: import.meta.env.DEV && import.meta.env.MODE !== "test",
});

export function trackActionFailed(action: string, error: unknown): void {
  analytics.track("merchant_action_failed", {
    action,
    reason: errorReason(error),
  });
}

/** Runs `work`, reporting a failure under `action` before rethrowing it. */
export async function reportFailure<T>(
  action: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    trackActionFailed(action, error);
    throw error;
  }
}
