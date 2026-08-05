import { Module } from '@nestjs/common';
import { EVENT_PUBLISHER } from './event-publisher.interface';
import { KafkaEventPublisher } from './kafka-event-publisher';
import { EVENT_CONSUMER } from './event-consumer.interface';
import { KafkaEventConsumer } from './kafka-event-consumer';

/**
 * Exposes the eventing seams: EVENT_PUBLISHER (bound to KafkaEventPublisher)
 * and its mirror EVENT_CONSUMER (bound to KafkaEventConsumer). Swapping the
 * broker later is a single edit here, with no publishing or consuming code
 * changing (same shape as WalletModule).
 */
@Module({
  providers: [
    KafkaEventPublisher,
    { provide: EVENT_PUBLISHER, useExisting: KafkaEventPublisher },
    KafkaEventConsumer,
    { provide: EVENT_CONSUMER, useExisting: KafkaEventConsumer },
  ],
  exports: [EVENT_PUBLISHER, EVENT_CONSUMER],
})
export class EventsModule {}
