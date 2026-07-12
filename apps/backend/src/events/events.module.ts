import { Module } from '@nestjs/common';
import { EVENT_PUBLISHER } from './event-publisher.interface';
import { KafkaEventPublisher } from './kafka-event-publisher';

/**
 * Exposes the EventPublisher seam via EVENT_PUBLISHER, bound to
 * KafkaEventPublisher. Swapping the broker later is a single edit here,
 * with no publishing code changing (same shape as WalletModule).
 */
@Module({
  providers: [
    KafkaEventPublisher,
    { provide: EVENT_PUBLISHER, useExisting: KafkaEventPublisher },
  ],
  exports: [EVENT_PUBLISHER],
})
export class EventsModule {}
