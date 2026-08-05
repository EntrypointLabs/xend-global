export const EVENT_PUBLISHER = Symbol('EventPublisher');

/** Topic catalog lives in ADR 0012. Payloads are JSON objects. */
export interface PlatformEvent {
  topic: string;
  key: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}

export interface EventPublisher {
  publish(event: PlatformEvent): Promise<void>;
}
