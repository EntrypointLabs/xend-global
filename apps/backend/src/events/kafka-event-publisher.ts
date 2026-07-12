import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Producer, type SASLOptions } from 'kafkajs';
import { EventPublisher, PlatformEvent } from './event-publisher.interface';

/**
 * Kafka-backed EventPublisher. Bound behind EVENT_PUBLISHER so kafkajs
 * never leaks past this module (Grid-incident rule, ADR 0010). Producing
 * events is Phase 2's job; this class makes the broker connection exist and
 * fail loud at boot, mirroring the config posture of the other adapters.
 */
@Injectable()
export class KafkaEventPublisher
  implements EventPublisher, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(KafkaEventPublisher.name);
  private producer!: Producer;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const brokers = this.config
      .getOrThrow<string>('KAFKA_BROKERS')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    const clientId = this.config.getOrThrow<string>('KAFKA_CLIENT_ID');
    const ssl = this.config.get<boolean>('KAFKA_SSL') ?? false;

    // SASL is only for managed brokers; local docker-compose leaves the
    // username blank, so pass a sasl object only when it is present. Joi
    // constrains KAFKA_SASL_MECHANISM to the password-based mechanisms, so
    // the cast to the discriminated SASLOptions union is sound here.
    const username = this.config.get<string>('KAFKA_SASL_USERNAME');
    const sasl: SASLOptions | undefined = username
      ? ({
          mechanism: this.config.get<string>('KAFKA_SASL_MECHANISM'),
          username,
          password: this.config.get<string>('KAFKA_SASL_PASSWORD') ?? '',
        } as SASLOptions)
      : undefined;

    const kafka = new Kafka({ clientId, brokers, ssl, sasl });
    this.producer = kafka.producer();
    await this.producer.connect();
    this.logger.log(
      `kafka.connect brokers=${brokers.join(',')} client_id=${clientId}`,
    );
  }

  async publish(event: PlatformEvent): Promise<void> {
    const { topic, key, payload, correlationId } = event;
    await this.producer.send({
      topic,
      messages: [
        {
          key,
          value: JSON.stringify(payload),
          headers: correlationId
            ? { 'x-correlation-id': correlationId }
            : undefined,
        },
      ],
    });
  }

  async onApplicationShutdown() {
    await this.producer.disconnect();
  }
}
