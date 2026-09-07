import { trace } from '@opentelemetry/api';

export const CORRELATION_ID_ATTRIBUTE = 'xend.correlation_id';

/**
 * Stamps the request's correlation id on whatever span is active. With
 * tracing off there is no active span and this is a no-op, so the middleware
 * can call it unconditionally.
 */
export function tagActiveSpanWithCorrelationId(id: string): void {
  trace.getActiveSpan()?.setAttribute(CORRELATION_ID_ATTRIBUTE, id);
}
