import type { ConfigService } from '@nestjs/config';
import type { PlatformEvent } from './event-publisher.interface';

type EachMessage = (arg: {
  topic: string;
  message: {
    key?: Buffer;
    value?: Buffer;
    headers?: Record<string, Buffer>;
  };
}) => Promise<void>;

const captured: { eachMessage?: EachMessage } = {};

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    consumer: () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockImplementation((arg: { eachMessage: EachMessage }) => {
        captured.eachMessage = arg.eachMessage;
        return Promise.resolve();
      }),
      disconnect: jest.fn().mockResolvedValue(undefined),
    }),
  })),
}));

// Imported after the mock is registered.
import { KafkaEventConsumer } from './kafka-event-consumer';

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    KAFKA_BROKERS: 'localhost:9092',
    KAFKA_CLIENT_ID: 'xend-backend',
    KAFKA_SSL: false,
  };
  return {
    get: (k: string) => values[k],
    getOrThrow: (k: string) => values[k],
  } as unknown as ConfigService;
}

describe('KafkaEventConsumer', () => {
  it('wires eachMessage and maps a message into a PlatformEvent', async () => {
    const consumer = new KafkaEventConsumer(makeConfig());
    const received: PlatformEvent[] = [];
    await consumer.subscribe(['payment.succeeded'], 'g1', (e) => {
      received.push(e);
      return Promise.resolve();
    });
    expect(captured.eachMessage).toBeDefined();

    await captured.eachMessage!({
      topic: 'payment.succeeded',
      message: {
        key: Buffer.from('pi_1'),
        value: Buffer.from(JSON.stringify({ intentId: 'pi_1', foo: 'bar' })),
        headers: { 'x-correlation-id': Buffer.from('pi_1') },
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].topic).toBe('payment.succeeded');
    expect(received[0].key).toBe('pi_1');
    expect(received[0].payload).toEqual({ intentId: 'pi_1', foo: 'bar' });
    expect(received[0].correlationId).toBe('pi_1');
  });

  it('propagates a handler throw so the offset is not committed', async () => {
    const consumer = new KafkaEventConsumer(makeConfig());
    await consumer.subscribe(['payment.succeeded'], 'g2', () =>
      Promise.reject(new Error('handler failed')),
    );
    await expect(
      captured.eachMessage!({
        topic: 'payment.succeeded',
        message: { key: Buffer.from('pi_1'), value: Buffer.from('{}') },
      }),
    ).rejects.toThrow('handler failed');
  });
});
