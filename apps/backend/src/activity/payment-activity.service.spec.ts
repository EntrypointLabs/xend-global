import type { DbService } from '../db/db.service';
import type { EventConsumer } from '../events/event-consumer.interface';
import type { ReconcilerService } from './reconciler.service';
import { PaymentActivityService } from './payment-activity.service';

function harness(signature = 'confirmed-chain-signature') {
  const rows = [
    { accountId: 'sa_consumer', vaultAddress: 'consumer-vault', signature },
  ];
  const query = {
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(rows),
  };
  const db = { client: { select: jest.fn().mockReturnValue(query) } };
  const consumer = { subscribe: jest.fn().mockResolvedValue(undefined) };
  const reconciler = { replayWallet: jest.fn().mockResolvedValue(1) };
  const service = new PaymentActivityService(
    consumer as unknown as EventConsumer,
    db as unknown as DbService,
    reconciler as unknown as ReconcilerService,
  );
  return { service, consumer, reconciler, query };
}

describe('confirmed Payment Activity indexing', () => {
  it('subscribes independently so Merchant webhook delivery is not consumed away', async () => {
    const { service, consumer } = harness();
    await service.onModuleInit();
    expect(consumer.subscribe).toHaveBeenCalledWith(
      ['payment.succeeded'],
      'payment-activity-indexer',
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
    expect(reconciler.replayWallet).toHaveBeenCalledWith(
      'sa_consumer',
      'consumer-vault',
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
      expect(reconciler.replayWallet).not.toHaveBeenCalled();
    },
  );

  it('leaves transient indexing failures retryable by the event consumer', async () => {
    const { service, reconciler } = harness();
    reconciler.replayWallet.mockRejectedValue(
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
    expect(reconciler.replayWallet).not.toHaveBeenCalled();
  });

  it('retries when RPC replay returns before the confirmed leg is visible', async () => {
    const { service, query } = harness();
    query.limit
      .mockResolvedValueOnce([
        {
          accountId: 'sa_consumer',
          vaultAddress: 'consumer-vault',
          signature: 'confirmed-chain-signature',
        },
      ])
      .mockResolvedValueOnce([]);
    await expect(
      service.handle({ topic: 'payment.succeeded', key: 'pi_1', payload: {} }),
    ).rejects.toThrow('not yet indexed');
  });
});
