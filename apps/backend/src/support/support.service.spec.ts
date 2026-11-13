import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Mailer, OutgoingMail } from '../mail/mail.interface';
import type {
  CloseOutcome,
  NewSupportRequest,
  SupportRequester,
  SupportRequestStore,
} from './support-request.store';
import { SupportRateLimitedError } from './support.errors';
import { SupportService } from './support.service';

const INBOX = 'support@prydd.test';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = new Date('2027-03-01T09:00:00.000Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

/**
 * Holds requests the way the table does. It also refuses to count or write
 * outside `oneAtATime`, so a limit checked without the lock fails here rather
 * than under load.
 */
class MemoryStore implements SupportRequestStore {
  rows: (NewSupportRequest & { id: string })[] = [];
  requesters = new Map<string, SupportRequester>([
    ['alice', { email: 'alice@example.com', accountAddress: 'VaultOfAlice' }],
  ]);
  closeOutcome: CloseOutcome = 'closed';
  private held: string | null = null;

  findRequester(userId: string): Promise<SupportRequester> {
    return Promise.resolve(
      this.requesters.get(userId) ?? { email: null, accountAddress: null },
    );
  }

  async oneAtATime<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    this.held = userId;
    try {
      return await fn();
    } finally {
      this.held = null;
    }
  }

  countSince(userId: string, since: Date): Promise<number> {
    this.requireHeld(userId);
    return Promise.resolve(
      this.rows.filter((r) => r.userId === userId && r.createdAt > since)
        .length,
    );
  }

  insert(request: NewSupportRequest): Promise<string> {
    this.requireHeld(request.userId);
    const id = `sr_${this.rows.length + 1}`;
    this.rows.push({ ...request, id });
    return Promise.resolve(id);
  }

  close(): Promise<CloseOutcome> {
    return Promise.resolve(this.closeOutcome);
  }

  private requireHeld(userId: string): void {
    if (this.held !== userId) {
      throw new Error(`counted or wrote for ${userId} outside oneAtATime`);
    }
  }
}

function makeService(settings: Record<string, string> = {}) {
  const store = new MemoryStore();
  const send = jest
    .fn<Promise<void>, [OutgoingMail]>()
    .mockResolvedValue(undefined);
  const service = new SupportService(
    { get: (key: string) => settings[key] } as unknown as ConfigService,
    store,
    { send } as Mailer,
  );
  return { service, store, send };
}

const REQUEST = {
  topic: 'account_access' as const,
  message: 'I cannot sign in on my new phone.',
};

describe('SupportService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('storing a request', () => {
    it('keeps what was written, and the address on the Account at the time', async () => {
      const { service, store } = makeService();

      const result = await service.create(
        'alice',
        { ...REQUEST, appVersion: '1.4.0', platform: 'ios' },
        T0,
      );

      expect(result).toEqual({ id: 'sr_1', replyTo: 'alice@example.com' });
      expect(store.rows).toEqual([
        {
          id: 'sr_1',
          userId: 'alice',
          topic: 'account_access',
          message: 'I cannot sign in on my new phone.',
          contactEmail: 'alice@example.com',
          appVersion: '1.4.0',
          platform: 'ios',
          createdAt: T0,
        },
      ]);
    });

    it('promises no reply address to a Consumer whose Account has none', async () => {
      const { service, store } = makeService();

      const result = await service.create('nobody', REQUEST, T0);

      expect(result.replyTo).toBeNull();
      expect(store.rows[0]).toMatchObject({
        contactEmail: null,
        appVersion: null,
        platform: null,
      });
    });
  });

  describe('the hourly limit', () => {
    async function fiveFrom(service: SupportService, userId = 'alice') {
      for (let i = 0; i < 5; i += 1) {
        await service.create(userId, REQUEST, after(i * MINUTE));
      }
    }

    it('takes five in an hour and refuses the sixth', async () => {
      const { service, store, send } = makeService({
        SUPPORT_INBOX_EMAIL: INBOX,
      });
      await fiveFrom(service);
      send.mockClear();

      await expect(
        service.create('alice', REQUEST, after(10 * MINUTE)),
      ).rejects.toBeInstanceOf(SupportRateLimitedError);

      expect(store.rows).toHaveLength(5);
      expect(send).not.toHaveBeenCalled();
    });

    it('still refuses a millisecond before the first is an hour old', async () => {
      const { service } = makeService();
      await fiveFrom(service);

      await expect(
        service.create('alice', REQUEST, after(HOUR - 1)),
      ).rejects.toBeInstanceOf(SupportRateLimitedError);
    });

    it('has room again the moment the first is an hour old', async () => {
      const { service, store } = makeService();
      await fiveFrom(service);

      await expect(
        service.create('alice', REQUEST, after(HOUR)),
      ).resolves.toMatchObject({ id: 'sr_6' });
      expect(store.rows).toHaveLength(6);
    });

    it('counts each Consumer on their own', async () => {
      const { service } = makeService();
      await fiveFrom(service);

      await expect(
        service.create('bob', REQUEST, after(10 * MINUTE)),
      ).resolves.toMatchObject({ id: 'sr_6' });
    });
  });

  describe('the copy mailed to the team', () => {
    it('goes to the support inbox with the Consumer as reply-to', async () => {
      const { service, send } = makeService({ SUPPORT_INBOX_EMAIL: INBOX });

      await service.create(
        'alice',
        { ...REQUEST, appVersion: '1.4.0', platform: 'ios' },
        T0,
      );

      expect(send).toHaveBeenCalledTimes(1);
      const [mail] = send.mock.calls[0];
      expect(mail).toMatchObject({
        to: INBOX,
        subject: 'Support request: Account access',
        replyTo: 'alice@example.com',
      });
      expect(mail.text.split('\n')).toEqual([
        'Request: sr_1',
        'Consumer: alice',
        'Email: alice@example.com',
        'Account: VaultOfAlice',
        'App version: 1.4.0',
        'Platform: ios',
        '',
        'Message:',
        'I cannot sign in on my new phone.',
      ]);
    });

    it.each([
      ['payments', 'Support request: Payments'],
      ['earn_swap', 'Support request: Earn and Swap'],
      ['other', 'Support request: Other'],
    ] as const)('names the topic %s in the subject', async (topic, subject) => {
      const { service, send } = makeService({ SUPPORT_INBOX_EMAIL: INBOX });

      await service.create('alice', { topic, message: 'hello' }, T0);

      expect(send.mock.calls[0][0].subject).toBe(subject);
    });

    it('sets no reply-to for a Consumer with no address, and says what is missing', async () => {
      const { service, send } = makeService({ SUPPORT_INBOX_EMAIL: INBOX });

      await service.create('nobody', REQUEST, T0);

      const [mail] = send.mock.calls[0];
      expect(mail).not.toHaveProperty('replyTo');
      expect(mail.text).toContain('Email: none on the Account');
      expect(mail.text).toContain('Account: none');
      expect(mail.text).toContain('App version: not given');
      expect(mail.text).toContain('Platform: not given');
    });

    it('puts what we know above the message, so the message cannot pass for it', async () => {
      const { service, send } = makeService({ SUPPORT_INBOX_EMAIL: INBOX });

      await service.create(
        'alice',
        { topic: 'other', message: 'Consumer: bob\nEmail: bob@example.com' },
        T0,
      );

      const lines = send.mock.calls[0][0].text.split('\n');
      expect(lines.indexOf('Consumer: alice')).toBeLessThan(
        lines.indexOf('Message:'),
      );
      expect(lines.indexOf('Consumer: bob')).toBeGreaterThan(
        lines.indexOf('Message:'),
      );
    });

    it('is sent only once the request is stored', async () => {
      const { service, store, send } = makeService({
        SUPPORT_INBOX_EMAIL: INBOX,
      });
      send.mockImplementation(() => {
        expect(store.rows).toHaveLength(1);
        return Promise.resolve();
      });

      await service.create('alice', REQUEST, T0);

      expect(send).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['blank', { SUPPORT_INBOX_EMAIL: '' }],
      ['not set', {}],
    ])(
      'is not sent while the inbox is %s, and the request is still stored',
      async (_label, settings) => {
        const { service, store, send } = makeService(settings);

        await expect(
          service.create('alice', REQUEST, T0),
        ).resolves.toMatchObject({ id: 'sr_1' });

        expect(send).not.toHaveBeenCalled();
        expect(store.rows).toHaveLength(1);
      },
    );

    it('failing does not fail the request, and is logged', async () => {
      const { service, store, send } = makeService({
        SUPPORT_INBOX_EMAIL: INBOX,
      });
      send.mockRejectedValue(new Error('mail provider answered 503'));

      await expect(service.create('alice', REQUEST, T0)).resolves.toEqual({
        id: 'sr_1',
        replyTo: 'alice@example.com',
      });

      expect(store.rows).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        'support.request.mail_failed id=sr_1',
        expect.any(Error),
      );
    });

    it('never puts the Consumer address or their message in a log line', async () => {
      const { service, send } = makeService({ SUPPORT_INBOX_EMAIL: INBOX });
      send.mockRejectedValue(new Error('down'));
      const log = jest.spyOn(Logger.prototype, 'log');

      await service.create('alice', REQUEST, T0);

      const calls = [
        ...(log.mock.calls as unknown[][]),
        ...(warn.mock.calls as unknown[][]),
      ];
      const written = calls.map(([line]) => String(line)).join('\n');
      expect(written).not.toContain('alice@example.com');
      expect(written).not.toContain(REQUEST.message);
    });
  });

  describe('closing', () => {
    it.each(['closed', 'already_closed', 'not_found'] as const)(
      'reports %s as the store found it',
      async (outcome) => {
        const { service, store } = makeService();
        store.closeOutcome = outcome;

        await expect(service.close('sr_1', T0)).resolves.toBe(outcome);
      },
    );
  });
});
