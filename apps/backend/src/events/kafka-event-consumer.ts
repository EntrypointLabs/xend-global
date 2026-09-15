import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Kafka,
  type Consumer,
  type KafkaMessage,
  type Producer,
  type SASLOptions,
} from 'kafkajs';
import type { PlatformEvent } from './event-publisher.interface';
import type { EventConsumer, EventHandler } from './event-consumer.interface';

/**
 * Kafka-backed EventConsumer, the mirror of KafkaEventPublisher. kafkajs
 * never leaks past this module (ADR 0010). A handler throw does not commit the
 * offset, so kafkajs redelivers: at-least-once, and handlers must be
 * idempotent. The domain field is `payload`, matching Phase 1's PlatformEvent
 * interface exactly (kafkajs `value` exists only inside the message envelope).
 *
 * A message that cannot be parsed, or whose handler keeps failing past
 * KAFKA_CONSUMER_MAX_ATTEMPTS, is copied to KAFKA_DEAD_LETTER_TOPIC and its
 * offset committed, so one poison message cannot stall its partition forever.
 */
@Injectable()
export class KafkaEventConsumer
  implements EventConsumer, OnApplicationShutdown
{
  private readonly logger = new Logger(KafkaEventConsumer.name);
  private readonly kafka: Kafka;
  private readonly consumers: Consumer[] = [];
  private readonly deadLetterTopic: string;
  private readonly maxAttempts: number;
  /** Failed deliveries seen by this process, keyed topic:partition:offset. */
  private readonly attempts = new Map<string, number>();
  private producer: Producer | undefined;

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
    this.deadLetterTopic =
      this.config.get<string>('KAFKA_DEAD_LETTER_TOPIC') ??
      'events.dead-letter';
    this.maxAttempts =
      this.config.get<number>('KAFKA_CONSUMER_MAX_ATTEMPTS') ?? 5;
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
      eachMessage: async ({ topic, partition, message }) => {
        const ref = `${topic}:${partition}:${message.offset}`;
        const event = this.decode(topic, message);
        if (!event) {
          await this.deadLetter(topic, message, 'unparseable payload');
          return;
        }
        try {
          await handler(event);
          this.attempts.delete(ref);
        } catch (err) {
          const seen = (this.attempts.get(ref) ?? 0) + 1;
          if (seen >= this.maxAttempts) {
            this.attempts.delete(ref);
            await this.deadLetter(
              topic,
              message,
              `handler failed ${seen} times: ${(err as Error).message}`,
            );
            return;
          }
          this.attempts.set(ref, seen);
          // The throw leaves the offset uncommitted so kafkajs redelivers.
          throw err;
        }
      },
    });
    this.consumers.push(consumer);
    this.logger.log(
      `kafka.consumer.subscribe group_id=${groupId} topics=${topics.join(',')}`,
    );
  }

  private decode(topic: string, message: KafkaMessage): PlatformEvent | null {
    const raw = message.value?.toString() ?? '{}';
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      return null;
    }
    return {
      topic,
      key: message.key?.toString() ?? '',
      payload: payload as Record<string, unknown>,
      correlationId: message.headers?.['x-correlation-id']?.toString(),
    };
  }

  private async deadLetter(
    topic: string,
    message: KafkaMessage,
    reason: string,
  ): Promise<void> {
    this.logger.error(
      `kafka.consumer.dead_letter topic=${topic} key=${message.key?.toString() ?? ''} offset=${message.offset} reason=${reason}`,
    );
    const producer = await this.deadLetterProducer();
    await producer.send({
      topic: this.deadLetterTopic,
      messages: [
        {
          key: message.key,
          value: message.value,
          headers: {
            ...(message.headers ?? {}),
            'x-original-topic': topic,
            'x-dead-letter-reason': reason,
          },
        },
      ],
    });
  }

  private async deadLetterProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer();
      await this.producer.connect();
    }
    return this.producer;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([
      ...this.consumers.map((c) => c.disconnect()),
      this.producer?.disconnect() ?? Promise.resolve(),
    ]);
  }
}
