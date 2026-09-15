/* eslint-disable @typescript-eslint/unbound-method */
import type { DbService } from '../db/db.service';
import { accountEventKindEnum, users } from '../db/schema';
import type { Mailer } from '../mail/mail.interface';
import type { PushSender } from './push-sender.interface';
import {
  SecurityNoticeService,
  type SecurityEvent,
} from './security-notice.service';

interface FakeDbOptions {
  /** The Consumer's contact address; null for a fixture with none. */
  email?: string | null;
  tokens?: string[];
}

/**
 * Only the two reads the service makes: the contact address and the device
 * list. Records which columns each read asked for, so a test can prove the
 * arrival preference was never consulted.
 */
function makeFakeDb({
  email = 'consumer@example.com',
  tokens = [],
}: FakeDbOptions = {}) {
  const selected: unknown[][] = [];
  const deleted: unknown[] = [];

  const client = {
    select: (columns: Record<string, unknown>) => {
      selected.push(Object.values(columns));
      return {
        from: (table: unknown) => ({
          where: () => {
            if (table === users) {
              return { limit: () => Promise.resolve([{ email }]) };
            }
            return Promise.resolve(tokens.map((token) => ({ token })));
          },
        }),
      };
    },
    delete: () => ({
      where: (clause: unknown) => {
        deleted.push(clause);
        return Promise.resolve();
      },
    }),
  };

  return { db: { client } as unknown as DbService, selected, deleted };
}

function makeSender(invalidTokens: string[] = []) {
  return {
    send: jest.fn().mockResolvedValue({ invalidTokens }),
  } as unknown as PushSender;
}

function makeMailer() {
  return { send: jest.fn().mockResolvedValue(undefined) } as unknown as Mailer;
}

function event(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    userId: 'user-1',
    kind: 'settings_change_staged',
    subject: null,
    previousSubject: null,
    occurredAt: new Date('2026-08-30T14:05:00Z'),
    ...overrides,
  };
}

function sentMessages(sender: PushSender) {
  return (sender.send as jest.Mock).mock.calls.flatMap(
    (call: [{ token: string; title: string; body: string; data: unknown }[]]) =>
      call[0],
  );
}

function sentMails(mailer: Mailer) {
  return (mailer.send as jest.Mock).mock.calls.map(
    (call: [{ to: string; subject: string; text: string }]) => call[0],
  );
}

describe('SecurityNoticeService', () => {
  it('reaches every registered device without asking about the arrival preference', async () => {
    const { db, selected } = makeFakeDb({
      tokens: ['tok-phone', 'tok-tablet'],
    });
    const sender = makeSender();
    const service = new SecurityNoticeService(db, sender, makeMailer());

    await service.deliver(event({ kind: 'settings_change_staged' }), {
      change: 'device',
    });

    const messages = sentMessages(sender);
    expect(messages.map((m) => m.token)).toEqual(['tok-phone', 'tok-tablet']);
    // Lands on the review of the change, the only screen that can reject it.
    expect(messages[0].data).toEqual({ kind: 'pending_change' });
    // The one column that must never be joined in. A Consumer who turned off
    // "tell me when money arrives" has not asked to be kept in the dark about
    // their account being changed.
    for (const columns of selected) {
      expect(columns).not.toContain(users.notificationsEnabled);
    }
  });

  it('names the limit and the delay when a Spending Limit change is staged', async () => {
    const { db } = makeFakeDb({ tokens: ['tok'] });
    const mailer = makeMailer();
    const sender = makeSender();
    const service = new SecurityNoticeService(db, sender, mailer);

    await service.deliver(
      event({ kind: 'settings_change_staged', subject: '$250 a day' }),
      { change: 'spending_limit' },
    );

    const [push] = sentMessages(sender);
    expect(push.title).toBe('Your spending limit is changing');
    expect(push.body).toContain('$250 a day');
    expect(push.body).toContain('24 hour delay');
    expect(sentMails(mailer)[0].text).toContain(
      'A change of your spending limit to $250 a day was started',
    );
  });

  it('mails the old address and the new one when the contact address rotates', async () => {
    const { db } = makeFakeDb({ tokens: ['tok'] });
    const mailer = makeMailer();
    const service = new SecurityNoticeService(db, makeSender(), mailer);

    await service.deliver(
      event({
        kind: 'contact_email_changed',
        subject: 'new@example.com',
        previousSubject: 'old@example.com',
      }),
    );

    const mails = sentMails(mailer);
    expect(mails.map((m) => m.to)).toEqual([
      'old@example.com',
      'new@example.com',
    ]);
    // The old inbox is the one that has to raise the alarm.
    expect(mails[0].text).toContain(
      'changed from old@example.com to new@example.com',
    );
    expect(mails[0].text).toContain('If this was not you');
    expect(mails[1].text).toContain('became the contact email');
  });

  it('still mails when no device is registered', async () => {
    const { db } = makeFakeDb({ tokens: [] });
    const sender = makeSender();
    const mailer = makeMailer();
    const service = new SecurityNoticeService(db, sender, mailer);

    await service.deliver(
      event({ kind: 'recovery_key_added', subject: 'a@example.com' }),
    );

    expect(sender.send).not.toHaveBeenCalled();
    expect(sentMails(mailer)).toEqual([
      expect.objectContaining({
        to: 'consumer@example.com',
        subject: 'A recovery key was added to your Xend account',
      }),
    ]);
  });

  it('still pushes, and does not throw, when there is no email on file', async () => {
    const { db } = makeFakeDb({ email: null, tokens: ['tok'] });
    const sender = makeSender();
    const mailer = makeMailer();
    const service = new SecurityNoticeService(db, sender, mailer);

    await expect(
      service.deliver(event({ kind: 'device_rotated', subject: 'Key2' })),
    ).resolves.toBeUndefined();

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('lets neither channel take the other down, nor the caller', async () => {
    const { db } = makeFakeDb({ tokens: ['tok'] });
    const deadSender = {
      send: jest.fn().mockRejectedValue(new Error('expo down')),
    } as unknown as PushSender;
    const deadMailer = {
      send: jest.fn().mockRejectedValue(new Error('resend down')),
    } as unknown as Mailer;

    await expect(
      new SecurityNoticeService(db, deadSender, makeMailer()).deliver(
        event({ kind: 'settings_change_rejected' }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      new SecurityNoticeService(db, makeSender(), deadMailer).deliver(
        event({ kind: 'settings_change_rejected' }),
      ),
    ).resolves.toBeUndefined();
  });

  it('forgets a token the provider says is dead for good', async () => {
    const { db, deleted } = makeFakeDb({ tokens: ['tok-gone'] });
    const service = new SecurityNoticeService(
      db,
      makeSender(['tok-gone']),
      makeMailer(),
    );

    await service.deliver(event({ kind: 'passkey_enrolled' }));

    expect(deleted).toHaveLength(1);
  });

  it('says nothing about an executed change or a renamed wallet', async () => {
    const { db } = makeFakeDb({ tokens: ['tok'] });
    const sender = makeSender();
    const mailer = makeMailer();
    const service = new SecurityNoticeService(db, sender, mailer);

    // Execution is announced by the event that says what executed; a name
    // is Activity and stays under the arrival preference.
    await service.deliver(event({ kind: 'settings_change_executed' }));
    await service.deliver(event({ kind: 'wallet_renamed', subject: 'Gift' }));

    expect(sender.send).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('softens the notice for a change the Consumer started, and not otherwise', async () => {
    const { db } = makeFakeDb({ tokens: ['tok'] });
    const sender = makeSender();
    const service = new SecurityNoticeService(db, sender, makeMailer());

    await service.deliver(event({ subject: 'a@example.com' }), {
      change: 'recovery_key',
    });
    await service.deliver(event());

    const [own, unknown] = sentMessages(sender);
    expect(own.title).toBe('Your recovery key change is on its way');
    expect(unknown.title).toBe('Check your Xend account');
    expect(unknown.body).toContain('open Xend and reject it');
  });

  it('says when, what, and what to do, in plain words, for every kind', async () => {
    const { db } = makeFakeDb({ tokens: ['tok'] });
    const sender = makeSender();
    const mailer = makeMailer();
    const service = new SecurityNoticeService(db, sender, mailer);

    for (const kind of accountEventKindEnum.enumValues) {
      await service.deliver(
        event({
          kind,
          subject: 'a@example.com',
          previousSubject: 'b@example.com',
        }),
      );
    }

    const texts = [
      ...sentMails(mailer).flatMap((m) => [m.subject, m.text]),
      ...sentMessages(sender).flatMap((m) => [m.title, m.body]),
    ];
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      // A Consumer reading this has never heard of a signer or a threshold.
      expect(text).not.toMatch(
        /\bS[123]\b|signer|multisig|threshold|quorum|\u2014/i,
      );
    }
    for (const mail of sentMails(mailer)) {
      expect(mail.text).toContain('30 Aug 2026, 14:05 UTC');
      expect(mail.text).toMatch(/not you|did not expect/);
    }
  });
});
