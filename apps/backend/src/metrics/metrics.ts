import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

export const metricsRegistry = new Registry();

let defaultMetricsStarted = false;

/** Process, heap, GC and event-loop gauges. Idempotent across module inits. */
export function startDefaultMetrics(): void {
  if (defaultMetricsStarted) return;
  defaultMetricsStarted = true;
  collectDefaultMetrics({ register: metricsRegistry });
}

export const paymentIntentTransitions = new Counter({
  name: 'xend_payment_intent_transitions_total',
  help: 'Payment intent status transitions, labelled by the states moved between.',
  labelNames: ['from', 'to'] as const,
  registers: [metricsRegistry],
});

export type SettlementOutcome = 'succeeded' | 'failed' | 'timed_out';

export const settlementConfirmations = new Counter({
  name: 'xend_settlement_confirmations_total',
  help: 'Settlement attempts finalised, by outcome.',
  labelNames: ['outcome'] as const,
  registers: [metricsRegistry],
});

export type WebhookDeliveryOutcome = 'succeeded' | 'failed' | 'exhausted';

export const webhookDeliveries = new Counter({
  name: 'xend_webhook_deliveries_total',
  help: 'Outbound merchant webhook delivery attempts, by outcome.',
  labelNames: ['outcome'] as const,
  registers: [metricsRegistry],
});

export const capacityReservationsRefused = new Counter({
  name: 'xend_capacity_reservations_refused_total',
  help: 'Capacity reservations refused at authorization, by reason.',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
});

export const httpRequestDuration = new Histogram({
  name: 'xend_http_request_duration_seconds',
  help: 'HTTP request duration by route template and response status.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});
