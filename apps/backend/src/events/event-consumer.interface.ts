import type { PlatformEvent } from './event-publisher.interface';

/** DI token for the active event consumer (mirror of EVENT_PUBLISHER). */
export const EVENT_CONSUMER = Symbol('EventConsumer');

export type EventHandler = (event: PlatformEvent) => Promise<void>;

export interface EventConsumer {
  /** Subscribe a durable consumer group to topics. At-least-once:
   *  the handler must be idempotent. */
  subscribe(
    topics: string[],
    groupId: string,
    handler: EventHandler,
  ): Promise<void>;
}
