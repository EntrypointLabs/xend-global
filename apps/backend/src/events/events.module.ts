import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EVENT_PUBLISHER } from './event-publisher.interface';
import { KafkaEventPublisher } from './kafka-event-publisher';
import { EVENT_CONSUMER } from './event-consumer.interface';
import { KafkaEventConsumer } from './kafka-event-consumer';
import { LoggingEventPublisher } from './logging-event-publisher';
import { DisabledEventConsumer } from './disabled-event-consumer';
import { AnalyticsEventPublisher } from '../analytics/analytics-event-publisher';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ServerAnalytics } from '../analytics/server-analytics.service';

export function brokerConfigured(config: ConfigService): boolean {
  return Boolean(config.get<string>('KAFKA_BROKERS')?.trim());
}

/**
 * Exposes the eventing seams: EVENT_PUBLISHER and its mirror EVENT_CONSUMER.
 * They bind to Kafka when KAFKA_BROKERS is set and to the logging stand-ins
 * otherwise (ADR 0038). No publishing or consuming code depends on which.
 */
@Module({
  imports: [AnalyticsModule],
  providers: [
    {
      provide: EVENT_PUBLISHER,
      inject: [ConfigService, ServerAnalytics],
      useFactory: (config: ConfigService, analytics: ServerAnalytics) =>
        new AnalyticsEventPublisher(
          brokerConfigured(config)
            ? new KafkaEventPublisher(config)
            : new LoggingEventPublisher(),
          analytics,
        ),
    },
    {
      provide: EVENT_CONSUMER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        brokerConfigured(config)
          ? new KafkaEventConsumer(config)
          : new DisabledEventConsumer(),
    },
  ],
  exports: [EVENT_PUBLISHER, EVENT_CONSUMER],
})
export class EventsModule {}
