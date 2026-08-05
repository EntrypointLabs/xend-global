import type { ConfigService } from '@nestjs/config';
import { KafkaEventPublisher } from './kafka-event-publisher';

/**
 * Unit tests for KafkaEventPublisher.publish. The kafkajs producer is faked
 * (no broker), so these assert the message-shaping contract only: topic,
 * key, serialized payload, and the correlation-ID header propagation.
 */
describe('KafkaEventPublisher', () => {
  function makePublisher() {
    const producer = {
      send: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    const config = {} as ConfigService;
    const publisher = new KafkaEventPublisher(config);
    (publisher as unknown as { producer: typeof producer }).producer = producer;
    return { publisher, producer };
  }

  it('forwards topic, key, and serialized payload to the producer', async () => {
    const { publisher, producer } = makePublisher();
    await publisher.publish({
      topic: 'payment.succeeded',
      key: 'pay_123',
      payload: { amount: '1000', currency: 'USDC' },
    });
    expect(producer.send).toHaveBeenCalledWith({
      topic: 'payment.succeeded',
      messages: [
        {
          key: 'pay_123',
          value: JSON.stringify({ amount: '1000', currency: 'USDC' }),
          headers: undefined,
        },
      ],
    });
  });

  it('sets the x-correlation-id header when a correlationId is given', async () => {
    const { publisher, producer } = makePublisher();
    await publisher.publish({
      topic: 'payment.created',
      key: 'pay_456',
      payload: { intentId: 'pay_456' },
      correlationId: 'corr_abc123',
    });
    const [arg] = producer.send.mock.calls[0] as [
      { messages: { headers?: Record<string, string> }[] },
    ];
    expect(arg.messages[0].headers).toEqual({
      'x-correlation-id': 'corr_abc123',
    });
  });

  it('disconnects the producer on shutdown', async () => {
    const { publisher, producer } = makePublisher();
    await publisher.onApplicationShutdown();
    expect(producer.disconnect).toHaveBeenCalled();
  });
});
