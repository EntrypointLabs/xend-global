import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventPublisher, PlatformEvent } from './event-publisher.interface';

/**
 * Stands in for Kafka when no broker is configured (ADR 0038). Events are
 * logged and dropped, so nothing downstream of them (Merchant webhooks, the
 * Activity fast path) runs until a broker is set.
 */
@Injectable()
export class LoggingEventPublisher implements EventPublisher, OnModuleInit {
  private readonly logger = new Logger(LoggingEventPublisher.name);

  onModuleInit() {
    this.logger.warn(
      'events.broker_disabled KAFKA_BROKERS is unset; platform events are logged and dropped',
    );
  }

  publish(event: PlatformEvent): Promise<void> {
    this.logger.log(
      `events.dropped topic=${event.topic} key=${event.key} correlation_id=${event.correlationId ?? ''}`,
    );
    return Promise.resolve();
  }
}
