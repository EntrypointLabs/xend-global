import { createWebAnalytics } from "@prydd/analytics/web";

export { bucketAmount, routeToScreenName } from "@prydd/analytics";

// Safe to import from server-rendered client components: without a window
// this is a no-op client, so PostHog only starts in the browser.
export const analytics = createWebAnalytics({
  app: "shop",
  apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  apiHost: process.env.NEXT_PUBLIC_POSTHOG_HOST || undefined,
  debug: process.env.NODE_ENV === "development",
});
