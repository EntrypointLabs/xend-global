import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EventsModule } from './events.module';
import { EVENT_PUBLISHER, EventPublisher } from './event-publisher.interface';
import { EVENT_CONSUMER, EventConsumer } from './event-consumer.interface';
import { KafkaEventPublisher } from './kafka-event-publisher';
import { KafkaEventConsumer } from './kafka-event-consumer';
import { LoggingEventPublisher } from './logging-event-publisher';
import { DisabledEventConsumer } from './disabled-event-consumer';
import { AnalyticsEventPublisher } from '../analytics/analytics-event-publisher';

const innerPublisher = (publisher: unknown) =>
  (publisher as AnalyticsEventPublisher).inner;

type ConfigValues = Record<string, string | undefined>;

function configModule(values: ConfigValues) {
  const config = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    },
  };
  @Global()
  @Module({
    providers: [{ provide: ConfigService, useValue: config }],
    exports: [ConfigService],
  })
  class FakeConfigModule {}
  return FakeConfigModule;
}

async function compile(values: ConfigValues) {
  return Test.createTestingModule({
    imports: [configModule(values), EventsModule],
  }).compile();
}

describe('EventsModule', () => {
  it('binds Kafka when KAFKA_BROKERS is set', async () => {
    const moduleRef = await compile({
      KAFKA_BROKERS: 'localhost:9092',
      KAFKA_CLIENT_ID: 'test',
    });

    expect(moduleRef.get(EVENT_PUBLISHER)).toBeInstanceOf(
      AnalyticsEventPublisher,
    );
    expect(innerPublisher(moduleRef.get(EVENT_PUBLISHER))).toBeInstanceOf(
      KafkaEventPublisher,
    );
    expect(moduleRef.get(EVENT_CONSUMER)).toBeInstanceOf(KafkaEventConsumer);
  });

  it.each<ConfigValues>([{}, { KAFKA_BROKERS: '' }, { KAFKA_BROKERS: '  ' }])(
    'boots without a broker when KAFKA_BROKERS is %j',
    async (values) => {
      const moduleRef = await compile(values);
      const app = moduleRef.createNestApplication({ logger: false });
      await app.init();

      const publisher = app.get<EventPublisher>(EVENT_PUBLISHER);
      const consumer = app.get<EventConsumer>(EVENT_CONSUMER);
      expect(innerPublisher(publisher)).toBeInstanceOf(LoggingEventPublisher);
      expect(consumer).toBeInstanceOf(DisabledEventConsumer);

      const handler = jest.fn();
      await consumer.subscribe(['payment.succeeded'], 'group', handler);
      await publisher.publish({
        topic: 'payment.succeeded',
        key: 'intent-1',
        payload: {},
      });
      expect(handler).not.toHaveBeenCalled();

      await app.close();
    },
  );
});
