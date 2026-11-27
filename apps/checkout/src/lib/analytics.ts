import {
  bucketAmount,
  createAnalytics,
  type Analytics,
  type AnalyticsTransport,
  type EventName,
} from '@prydd/analytics';

const apiKey = import.meta.env.VITE_POSTHOG_KEY;
const apiHost = import.meta.env.VITE_POSTHOG_HOST || undefined;

/**
 * posthog-js would roughly double the popup's first-paint bundle, so it loads
 * in its own chunk once the page is idle. Calls made before it arrives are
 * queued and replayed in order.
 */
function lazyTransport(): AnalyticsTransport | null {
  if (!apiKey || typeof window === 'undefined') return null;
  let client: Analytics | null = null;
  let queue: ((loaded: Analytics) => void)[] | null = [];
  const send = (call: (loaded: Analytics) => void) => {
    if (client) call(client);
    else if (queue) queue.push(call);
  };

  const load = () => {
    import('@prydd/analytics/web')
      .then(({ createWebAnalytics }) => {
        // Payers stay anonymous and nothing persists in the merchant's page:
        // identify is never called and storage is memory only.
        client = createWebAnalytics({
          app: 'checkout',
          apiKey,
          apiHost,
          memoryOnly: true,
        });
        for (const call of queue ?? []) call(client);
        queue = null;
      })
      .catch(() => {
        queue = null;
      });
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(load, { timeout: 3000 });
  } else {
    setTimeout(load, 1000);
  }

  return {
    capture: (event, props) =>
      send((a) => a.track(event as EventName, props as never)),
    screen: (name, props) => send((a) => a.screen(name, props)),
    identify: () => {},
    reset: () => send((a) => a.reset()),
  };
}

export const analytics = createAnalytics({
  app: 'checkout',
  transport: lazyTransport(),
  debug: import.meta.env.DEV && import.meta.env.MODE !== 'test',
});

/** The intent's USDC settlement amount as a range, never the exact figure. */
export function intentAmountBucket(intent: {
  usdcSettlementRaw: string;
}): string | undefined {
  const raw = Number(intent.usdcSettlementRaw);
  return Number.isFinite(raw)
    ? bucketAmount(raw / 1_000_000, 'USD')
    : undefined;
}
