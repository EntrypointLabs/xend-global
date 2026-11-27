import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import PostHog from "posthog-react-native";
import {
  bucketAmount,
  createAnalytics,
  errorReason,
  type FlowProps,
  type MoneyFlow,
} from "@prydd/analytics";
import { CLUSTER } from "@/utils/cluster";
import { SEED_DEMO } from "@/utils/devSeed";

const API_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

// Development builds stay out of the production project unless asked for, so
// a day of testing does not show up as a day of real usage.
const ENABLED =
  !!API_KEY &&
  !SEED_DEMO &&
  (!__DEV__ || process.env.EXPO_PUBLIC_POSTHOG_IN_DEV === "true");

export const posthog: PostHog | null = ENABLED
  ? new PostHog(API_KEY!, {
      host: HOST,
      customStorage: AsyncStorage,
      captureAppLifecycleEvents: true,
      enableSessionReplay: false,
      personProfiles: "identified_only",
    })
  : null;

if (posthog) {
  posthog.register({
    network: CLUSTER,
    app_version: Constants.expoConfig?.version ?? "unknown",
    environment: __DEV__ ? "development" : "production",
  });
}

export const analytics = createAnalytics({
  app: "mobile",
  debug: __DEV__,
  transport: posthog && {
    capture: (event, props) => posthog.capture(event, props),
    screen: (name, props) => void posthog.screen(name, props),
    identify: (id, props) => posthog.identify(id, props),
    reset: () => posthog.reset(),
  },
});

/**
 * One funnel for a money-moving flow. Holds the props given at the start so
 * later stages repeat them without each call site threading them through.
 */
export function trackFlow(flow: MoneyFlow, base: FlowProps = {}) {
  let props: FlowProps = { ...base };
  return {
    started(extra?: FlowProps) {
      props = { ...props, ...extra };
      analytics.track(`${flow}_started`, props);
    },
    submitted(extra?: FlowProps) {
      props = { ...props, ...extra };
      analytics.track(`${flow}_submitted`, props);
    },
    succeeded(extra?: FlowProps) {
      analytics.track(`${flow}_succeeded`, { ...props, ...extra });
    },
    failed(error: unknown, extra?: FlowProps) {
      analytics.track(`${flow}_failed`, {
        ...props,
        reason: errorReason(error),
        ...extra,
      });
    },
    cancelled(extra?: FlowProps) {
      analytics.track(`${flow}_cancelled`, { ...props, ...extra });
    },
  };
}

export { bucketAmount, errorReason };
