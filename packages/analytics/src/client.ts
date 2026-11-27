import type { AnalyticsEvents, AppName, EventName } from "./events";
import { sanitize, type Props } from "./sanitize";

/** The handful of calls each platform SDK has to provide. */
export interface AnalyticsTransport {
  capture(event: string, props: Props): void;
  screen(name: string, props: Props): void;
  identify(distinctId: string, props: Props): void;
  reset(): void;
}

export interface Analytics {
  track<E extends EventName>(event: E, props: AnalyticsEvents[E]): void;
  screen(name: string, props?: Record<string, unknown>): void;
  /** `userId` is the internal user id. Never an email or wallet address. */
  identify(userId: string, traits?: Record<string, unknown>): void;
  reset(): void;
}

export interface AnalyticsOptions {
  app: AppName;
  transport: AnalyticsTransport | null;
  /** Mirrors every call to the console, for development builds. */
  debug?: boolean;
  log?: (line: string, props: Props) => void;
}

export function createAnalytics({
  app,
  transport,
  debug = false,
  log = (line, props) => console.log(line, props),
}: AnalyticsOptions): Analytics {
  let identifiedAs: string | null = null;

  const safely = (fn: () => void) => {
    try {
      fn();
    } catch {
      // Analytics must never break a user flow.
    }
  };

  return {
    track(event, props) {
      const clean = sanitize({ ...(props as Record<string, unknown>), app });
      if (debug) log(`[analytics] ${event}`, clean);
      if (transport) safely(() => transport.capture(event, clean));
    },
    screen(name, props) {
      const clean = sanitize({ ...props, app });
      if (debug) log(`[analytics] screen ${name}`, clean);
      if (transport) safely(() => transport.screen(name, clean));
    },
    identify(userId, traits) {
      if (!userId || userId === identifiedAs) return;
      identifiedAs = userId;
      const clean = sanitize(traits);
      if (debug) log(`[analytics] identify`, clean);
      if (transport) safely(() => transport.identify(userId, clean));
    },
    reset() {
      identifiedAs = null;
      if (debug) log(`[analytics] reset`, {});
      if (transport) safely(() => transport.reset());
    },
  };
}
