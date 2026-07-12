import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Consumer, type SASLOptions } from 'kafkajs';
import type { PlatformEvent } from './event-publisher.interface';
import type { EventConsumer, EventHandler } from './event-consumer.interface';

/**
 * Kafka-backed EventConsumer, the mirror of KafkaEventPublisher. kafkajs
 * never leaks past this module (ADR 0010). A handler throw does not commit the
 * offset, so kafkajs redelivers: at-least-once, and handlers must be
 * idempotent. The domain field is `payload`, matching Phase 1's PlatformEvent
 * interface exactly (kafkajs `value` exists only inside the message envelope).
 */
@Injectable()
export class KafkaEventConsumer
  implements EventConsumer, OnApplicationShutdown
{
  private readonly logger = new Logger(KafkaEventConsumer.name);
  private readonly kafka: Kafka;
  private readonly consumers: Consumer[] = [];

  constructor(private readonly config: ConfigService) {
    const brokers = this.config
      .getOrThrow<string>('KAFKA_BROKERS')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    const clientId = this.config.getOrThrow<string>('KAFKA_CLIENT_ID');
    const ssl = this.config.get<boolean>('KAFKA_SSL') ?? false;
    const username = this.config.get<string>('KAFKA_SASL_USERNAME');
    const sasl: SASLOptions | undefined = username
      ? ({
          mechanism: this.config.get<string>('KAFKA_SASL_MECHANISM'),
          username,
          password: this.config.get<string>('KAFKA_SASL_PASSWORD') ?? '',
        } as SASLOptions)
      : undefined;
    this.kafka = new Kafka({ clientId, brokers, ssl, sasl });
  }

  async subscribe(
    topics: string[],
    groupId: string,
    handler: EventHandler,
  ): Promise<void> {
    const consumer = this.kafka.consumer({ groupId });
    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        const event: PlatformEvent = {
          topic,
          key: message.key?.toString() ?? '',
          payload: JSON.parse(message.value?.toString() ?? '{}') as Record<
            string,
            unknown
          >,
          correlationId: message.headers?.['x-correlation-id']?.toString(),
        };
        // A throw here leaves the offset uncommitted so kafkajs redelivers.
        await handler(event);
      },
    });
    this.consumers.push(consumer);
    this.logger.log(
      `kafka.consumer.subscribe group_id=${groupId} topics=${topics.join(',')}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.consumers.map((c) => c.disconnect()));
  }
}
