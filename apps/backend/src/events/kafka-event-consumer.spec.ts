import type { ConfigService } from '@nestjs/config';
import type { PlatformEvent } from './event-publisher.interface';

type EachMessage = (arg: {
  topic: string;
  partition: number;
  message: {
    key?: Buffer;
    value?: Buffer;
    offset: string;
    headers?: Record<string, Buffer>;
  };
}) => Promise<void>;

const captured: { eachMessage?: EachMessage } = {};
const producerSend = jest.fn().mockResolvedValue(undefined);
const producerConnect = jest.fn().mockResolvedValue(undefined);

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
    producer: () => ({
      connect: producerConnect,
      send: producerSend,
      disconnect: jest.fn().mockResolvedValue(undefined),
    }),
  })),
}));

// Imported after the mock is registered.
import { KafkaEventConsumer } from './kafka-event-consumer';

function makeConfig(maxAttempts = 3): ConfigService {
  const values: Record<string, unknown> = {
    KAFKA_BROKERS: 'localhost:9092',
    KAFKA_CLIENT_ID: 'xend-backend',
    KAFKA_SSL: false,
    KAFKA_DEAD_LETTER_TOPIC: 'events.dead-letter',
    KAFKA_CONSUMER_MAX_ATTEMPTS: maxAttempts,
  };
  return {
    get: (k: string) => values[k],
    getOrThrow: (k: string) => values[k],
  } as unknown as ConfigService;
}

function msg(over: {
  key?: string;
  value?: string;
  offset?: string;
  headers?: Record<string, Buffer>;
}) {
  return {
    topic: 'payment.succeeded',
    partition: 0,
    message: {
      key: Buffer.from(over.key ?? 'pi_1'),
      value: over.value === undefined ? undefined : Buffer.from(over.value),
      offset: over.offset ?? '1',
      headers: over.headers,
    },
  };
}

describe('KafkaEventConsumer', () => {
  beforeEach(() => {
    producerSend.mockClear();
    producerConnect.mockClear();
  });

  it('wires eachMessage and maps a message into a PlatformEvent', async () => {
    const consumer = new KafkaEventConsumer(makeConfig());
    const received: PlatformEvent[] = [];
    await consumer.subscribe(['payment.succeeded'], 'g1', (e) => {
      received.push(e);
      return Promise.resolve();
    });
    expect(captured.eachMessage).toBeDefined();

    await captured.eachMessage!(
      msg({
        value: JSON.stringify({ intentId: 'pi_1', foo: 'bar' }),
        headers: { 'x-correlation-id': Buffer.from('pi_1') },
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0].topic).toBe('payment.succeeded');
    expect(received[0].key).toBe('pi_1');
    expect(received[0].payload).toEqual({ intentId: 'pi_1', foo: 'bar' });
    expect(received[0].correlationId).toBe('pi_1');
    expect(producerSend).not.toHaveBeenCalled();
  });

  it('propagates a handler throw so the offset is not committed', async () => {
    const consumer = new KafkaEventConsumer(makeConfig());
    await consumer.subscribe(['payment.succeeded'], 'g2', () =>
      Promise.reject(new Error('handler failed')),
    );
    await expect(captured.eachMessage!(msg({ value: '{}' }))).rejects.toThrow(
      'handler failed',
    );
    expect(producerSend).not.toHaveBeenCalled();
  });

  it('parks an unparseable message on the dead-letter topic without calling the handler', async () => {
    const consumer = new KafkaEventConsumer(makeConfig());
    const handler = jest.fn().mockResolvedValue(undefined);
    await consumer.subscribe(['payment.succeeded'], 'g3', handler);

    await expect(
      captured.eachMessage!(msg({ value: '{not json', offset: '7' })),
    ).resolves.toBeUndefined();

    expect(handler).not.toHaveBeenCalled();
    expect(producerSend).toHaveBeenCalledTimes(1);
    const sent = (producerSend.mock.calls as unknown[][])[0][0] as {
      topic: string;
      messages: { headers: Record<string, string> }[];
    };
    expect(sent.topic).toBe('events.dead-letter');
    expect(sent.messages[0].headers['x-original-topic']).toBe(
      'payment.succeeded',
    );
    expect(sent.messages[0].headers['x-dead-letter-reason']).toContain(
      'unparseable',
    );
  });

  it('dead-letters a message whose handler keeps failing once attempts are capped', async () => {
    const consumer = new KafkaEventConsumer(makeConfig(3));
    const handler = jest.fn().mockRejectedValue(new Error('still broken'));
    await consumer.subscribe(['payment.succeeded'], 'g4', handler);
    const poison = msg({ value: '{"intentId":"pi_9"}', offset: '42' });

    await expect(captured.eachMessage!(poison)).rejects.toThrow('still broken');
    await expect(captured.eachMessage!(poison)).rejects.toThrow('still broken');
    // Third attempt is the cap: committed by returning, copied to the DLQ.
    await expect(captured.eachMessage!(poison)).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(3);
    expect(producerSend).toHaveBeenCalledTimes(1);
    const sent = (producerSend.mock.calls as unknown[][])[0][0] as {
      messages: { headers: Record<string, string> }[];
    };
    expect(sent.messages[0].headers['x-dead-letter-reason']).toContain(
      'failed 3 times',
    );

    // A fresh offset starts its own count rather than inheriting the cap.
    await expect(
      captured.eachMessage!(msg({ value: '{}', offset: '43' })),
    ).rejects.toThrow('still broken');
    expect(producerSend).toHaveBeenCalledTimes(1);
  });
});
