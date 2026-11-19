import { Injectable, Logger } from '@nestjs/common';
import type { EventConsumer } from './event-consumer.interface';

/** The consumer side of LoggingEventPublisher: subscriptions never receive anything. */
@Injectable()
export class DisabledEventConsumer implements EventConsumer {
  private readonly logger = new Logger(DisabledEventConsumer.name);

  subscribe(topics: string[], groupId: string): Promise<void> {
    this.logger.warn(
      `events.consumer_disabled group_id=${groupId} topics=${topics.join(',')}`,
    );
    return Promise.resolve();
  }
}
