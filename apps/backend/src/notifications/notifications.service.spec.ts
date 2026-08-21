/* eslint-disable @typescript-eslint/unbound-method */
import { NotificationsService } from './notifications.service';
import type { DbService } from '../db/db.service';
import type { PushSender } from './push-sender.interface';

interface FakeDbOptions {
  /** Tokens the arrival query returns, i.e. enabled devices of the owner. */
  tokens?: string[];
  /** What the user's stored preference reads as. */
  userEnabled?: boolean;
}

function makeFakeDb(opts: FakeDbOptions = {}) {
  const deleted: string[][] = [];
  const execute = jest.fn().mockResolvedValue({
    rows: (opts.tokens ?? []).map((token) => ({ token })),
  });

  const client = {
    execute,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              opts.userEnabled === undefined
                ? []
                : [{ enabled: opts.userEnabled }],
            ),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({
      where: (clause: unknown) => {
        deleted.push(clause as never);
        return Promise.resolve();
      },
    }),
  };

  return { db: { client } as unknown as DbService, execute, deleted };
}

function makeSender(invalidTokens: string[] = []) {
  return {
    send: jest.fn().mockResolvedValue({ invalidTokens }),
  } as unknown as PushSender;
}

describe('NotificationsService', () => {
  describe('notifyArrival', () => {
    it('tells every device the account owner has enabled', async () => {
      const { db } = makeFakeDb({ tokens: ['tok-phone', 'tok-tablet'] });
      const sender = makeSender();
      const service = new NotificationsService(db, sender);

      await service.notifyArrival({ smartAccountId: 'sa_1', amount: '5 SOL' });

      expect(sender.send).toHaveBeenCalledWith([
        { token: 'tok-phone', title: 'Money in', body: 'You received 5 SOL' },
        { token: 'tok-tablet', title: 'Money in', body: 'You received 5 SOL' },
      ]);
    });

    it('sends nothing when the owner has no enabled device', async () => {
      const { db } = makeFakeDb({ tokens: [] });
      const sender = makeSender();
      const service = new NotificationsService(db, sender);

      await service.notifyArrival({ smartAccountId: 'sa_1', amount: '1 USDC' });

      expect(sender.send).not.toHaveBeenCalled();
    });

    it('forgets a token the provider says is dead for good', async () => {
      // A reinstalled device keeps its old token alive in the table forever
      // otherwise, and every later notification pays to reach nobody.
      const { db, deleted } = makeFakeDb({ tokens: ['tok-gone'] });
      const service = new NotificationsService(db, makeSender(['tok-gone']));

      await service.notifyArrival({ smartAccountId: 'sa_1', amount: '1 USDC' });

      expect(deleted).toHaveLength(1);
    });

    it('never throws, because the transfer already happened', async () => {
      const { db } = makeFakeDb({ tokens: ['tok'] });
      const sender = {
        send: jest.fn().mockRejectedValue(new Error('expo down')),
      } as unknown as PushSender;
      const service = new NotificationsService(db, sender);

      await expect(
        service.notifyArrival({ smartAccountId: 'sa_1', amount: '1 USDC' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('isEnabled', () => {
    it('reads as on for a user who has never touched the setting', async () => {
      const { db } = makeFakeDb({ userEnabled: true });
      const service = new NotificationsService(db, makeSender());

      await expect(service.isEnabled('u_1')).resolves.toBe(true);
    });

    it('reads as off once they have turned it off', async () => {
      const { db } = makeFakeDb({ userEnabled: false });
      const service = new NotificationsService(db, makeSender());

      await expect(service.isEnabled('u_1')).resolves.toBe(false);
    });

    it('reads as on when the user row cannot be found', async () => {
      // Nothing has been silenced; there is simply nothing recorded.
      const { db } = makeFakeDb({});
      const service = new NotificationsService(db, makeSender());

      await expect(service.isEnabled('u_1')).resolves.toBe(true);
    });
  });
});
