import type { DbService } from '../db/db.service';
import type { ConfigService } from '@nestjs/config';
import type { EventConsumer } from '../events/event-consumer.interface';
import type { ReconcilerService } from './reconciler.service';
import { PaymentActivityService } from './payment-activity.service';

function harness(signature = 'confirmed-chain-signature') {
  const rows = [
    {
      accountId: 'sa_consumer',
      vaultAddress: 'consumer-vault',
      signature,
      executionCluster: 'devnet',
    },
  ];
  const query = {
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(rows),
  };
  const execute = jest.fn().mockResolvedValue({ rows: [] });
  const db = {
    client: { select: jest.fn().mockReturnValue(query), execute },
  };
  const consumer = { subscribe: jest.fn().mockResolvedValue(undefined) };
  const reconciler = { replayPayment: jest.fn().mockResolvedValue(1) };
  const service = new PaymentActivityService(
    consumer as unknown as EventConsumer,
    db as unknown as DbService,
    reconciler as unknown as ReconcilerService,
    {
      getOrThrow: () => 'devnet',
    } as unknown as ConfigService,
  );
  return { service, consumer, reconciler, query, execute };
}

describe('confirmed Payment Activity indexing', () => {
  it('subscribes independently so Merchant webhook delivery is not consumed away', async () => {
    const { service, consumer } = harness();
    await service.onModuleInit();
    expect(consumer.subscribe).toHaveBeenCalledWith(
      ['payment.succeeded'],
      'payment-activity-indexer-devnet',
      expect.any(Function),
    );
  });

  it('indexes the persisted Consumer vault, not addresses supplied in the event', async () => {
    const { service, reconciler } = harness();
    await service.handle({
      topic: 'payment.succeeded',
      key: 'pi_1',
      payload: { vaultAddress: 'untrusted' },
    });
    expect(reconciler.replayPayment).toHaveBeenCalledWith(
      'sa_consumer',
      'consumer-vault',
      'confirmed-chain-signature',
    );
  });

  it.each(['test_pi_1', 'devtest_sig_pi_1'])(
    'does not index simulated Payment %s',
    async (signature) => {
      const { service, reconciler } = harness(signature);
      await service.handle({
        topic: 'payment.succeeded',
        key: 'pi_1',
        payload: {},
      });
      expect(reconciler.replayPayment).not.toHaveBeenCalled();
    },
  );

  it('leaves transient indexing failures retryable by the event consumer', async () => {
    const { service, reconciler } = harness();
    reconciler.replayPayment.mockRejectedValue(
      new Error('RPC temporarily unavailable'),
    );
    await expect(
      service.handle({ topic: 'payment.succeeded', key: 'pi_1', payload: {} }),
    ).rejects.toThrow('RPC temporarily unavailable');
  });

  it('does not invent an Activity when no persisted Payment exists', async () => {
    const { service, reconciler, query } = harness();
    query.limit.mockResolvedValue([]);
    await service.handle({
      topic: 'payment.succeeded',
      key: 'missing',
      payload: {},
    });
    expect(reconciler.replayPayment).not.toHaveBeenCalled();
  });

  it('retries when RPC replay returns before the confirmed leg is visible', async () => {
    const { service, query } = harness();
    query.limit
      .mockResolvedValueOnce([
        {
          accountId: 'sa_consumer',
          vaultAddress: 'consumer-vault',
          signature: 'confirmed-chain-signature',
          executionCluster: 'devnet',
        },
      ])
      .mockResolvedValueOnce([]);
    await expect(
      service.handle({ topic: 'payment.succeeded', key: 'pi_1', payload: {} }),
    ).rejects.toThrow('not yet indexed');
  });

  it('periodically retries durable missing Payments after event retries are exhausted', async () => {
    const { service, reconciler, execute } = harness();
    execute.mockResolvedValue({
      rows: [
        {
          intentId: 'pi_1',
          accountId: 'sa_consumer',
          vaultAddress: 'consumer-vault',
          signature: 'confirmed-chain-signature',
        },
      ],
    });
    reconciler.replayPayment
      .mockRejectedValueOnce(new Error('RPC still unavailable'))
      .mockResolvedValueOnce(1);

    await expect(service.repairMissingPayments()).resolves.toBeUndefined();
    await expect(service.repairMissingPayments()).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(reconciler.replayPayment).toHaveBeenCalledTimes(2);
    expect(reconciler.replayPayment).toHaveBeenLastCalledWith(
      'sa_consumer',
      'consumer-vault',
      'confirmed-chain-signature',
    );
  });
});
