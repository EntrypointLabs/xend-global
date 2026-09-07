import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { CORRELATION_ID_ATTRIBUTE } from './span-correlation';

const INSTRUMENTATIONS = new Set([
  '@opentelemetry/instrumentation-http',
  '@opentelemetry/instrumentation-express',
  '@opentelemetry/instrumentation-pg',
  '@opentelemetry/instrumentation-ioredis',
  '@opentelemetry/instrumentation-kafkajs',
]);

let sdk: NodeSDK | undefined;

/**
 * Must run before Nest, Express, pg, ioredis or kafkajs are required, since
 * the instrumentations patch those modules at load time. Off unless an OTLP
 * endpoint is configured, so a local boot pays nothing for it.
 */
export function startTracing(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || sdk) return;

  process.env.OTEL_SERVICE_NAME ||= 'xend-backend';

  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        requestHook: (span, request) => {
          const headers = (request as { headers?: Record<string, unknown> })
            .headers;
          const inbound = headers?.['x-correlation-id'];
          if (typeof inbound === 'string' && inbound) {
            span.setAttribute(CORRELATION_ID_ATTRIBUTE, inbound);
          }
        },
      },
    }).filter((i) => INSTRUMENTATIONS.has(i.instrumentationName)),
  });
  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  const running = sdk;
  sdk = undefined;
  if (running) await running.shutdown();
}
