import posthog, { type CaptureResult, type PostHogConfig } from "posthog-js";
import { createAnalytics, type Analytics } from "./client";
import type { AppName } from "./events";

export interface WebAnalyticsOptions {
  app: AppName;
  /** PostHog project key. Without one, events only reach the console in dev. */
  apiKey: string | undefined;
  apiHost?: string;
  debug?: boolean;
  /**
   * Keep nothing in cookies or localStorage. Used by the hosted checkout, which
   * runs inside merchants' pages where storage is partitioned or blocked and
   * where a lasting identifier would follow the payer across shops.
   */
  memoryOnly?: boolean;
}

const URL_PROPS = [
  "$current_url",
  "$referrer",
  "$initial_current_url",
  "$initial_referrer",
  "$pathname",
  "$initial_pathname",
];

let currentScreen = "/";

/**
 * URLs carry order ids, payment references and checkout session tokens, so the
 * browser SDK's automatic URL properties are cut down to the origin plus the
 * route pattern this app last reported.
 */
function stripUrls(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  const scrub = (bag: Record<string, unknown> | undefined) => {
    if (!bag) return;
    for (const key of URL_PROPS) {
      if (!(key in bag)) continue;
      if (key.endsWith("pathname")) {
        bag[key] = currentScreen;
        continue;
      }
      try {
        const origin = new URL(String(bag[key])).origin;
        bag[key] = key.includes("referrer") ? origin : origin + currentScreen;
      } catch {
        delete bag[key];
      }
    }
  };
  scrub(event.properties);
  scrub(event.$set as Record<string, unknown> | undefined);
  scrub(event.$set_once as Record<string, unknown> | undefined);
  return event;
}

export function createWebAnalytics({
  app,
  apiKey,
  apiHost = "https://us.i.posthog.com",
  debug = false,
  memoryOnly = false,
}: WebAnalyticsOptions): Analytics {
  const enabled = typeof window !== "undefined" && !!apiKey;
  if (enabled) {
    const config: Partial<PostHogConfig> = {
      api_host: apiHost,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      person_profiles: "identified_only",
      persistence: memoryOnly ? "memory" : "localStorage+cookie",
      mask_all_text: true,
      mask_all_element_attributes: true,
      before_send: stripUrls,
    };
    posthog.init(apiKey, config);
    posthog.register({ app });
  }

  return createAnalytics({
    app,
    debug,
    transport: enabled
      ? {
          capture: (event, props) => posthog.capture(event, props),
          screen: (name, props) => {
            currentScreen = name;
            posthog.capture("$pageview", { ...props, screen: name });
          },
          identify: (id, props) => posthog.identify(id, props),
          reset: () => posthog.reset(),
        }
      : {
          capture: () => {},
          screen: (name) => {
            currentScreen = name;
          },
          identify: () => {},
          reset: () => {},
        },
  });
}
