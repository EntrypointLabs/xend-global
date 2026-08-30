import {
  ACCOUNT_EVENT_STORE,
  type AccountEventRow,
  type AccountEventStore,
  type NewAccountEvent,
} from './account-event.store';
import { AccountEventsService } from './account-events.service';
import { SecurityNoticeService } from '../notifications/security-notice.service';
import { Test } from '@nestjs/testing';

/** In-memory store. The dedupe rule is the database's, so this honours it. */
class FakeStore implements AccountEventStore {
  rows: AccountEventRow[] = [];
  private seq = 0;

  record(row: NewAccountEvent): Promise<AccountEventRow | null> {
    if (this.rows.some((r) => r.dedupeKey === row.dedupeKey)) {
      return Promise.resolve(null);
    }
    const created: AccountEventRow = {
      id: `event-${++this.seq}`,
      userId: row.userId,
      kind: row.kind,
      subject: row.subject ?? null,
      previousSubject: row.previousSubject ?? null,
      dedupeKey: row.dedupeKey,
      signature: row.signature ?? null,
      occurredAt: row.occurredAt ?? new Date(0),
      createdAt: new Date(0),
    };
    this.rows.push(created);
    return Promise.resolve(created);
  }

  listByUser(
    userId: string,
    {
      limit,
      before,
      after,
      kinds,
    }: {
      limit: number;
      before?: Date;
      after?: Date;
      kinds?: readonly AccountEventRow['kind'][];
    },
  ): Promise<AccountEventRow[]> {
    return Promise.resolve(
      this.rows
        .filter((r) => r.userId === userId)
        .filter((r) => (before ? r.occurredAt < before : true))
        .filter((r) => (after ? r.occurredAt > after : true))
        .filter((r) => (kinds ? kinds.includes(r.kind) : true))
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
        .slice(0, limit),
    );
  }
}

describe('AccountEventsService', () => {
  let service: AccountEventsService;
  let store: FakeStore;
  let deliver: jest.Mock;

  beforeEach(async () => {
    store = new FakeStore();
    deliver = jest.fn().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountEventsService,
        { provide: ACCOUNT_EVENT_STORE, useValue: store },
        { provide: SecurityNoticeService, useValue: { deliver } },
      ],
    }).compile();
    service = moduleRef.get(AccountEventsService);
  });

  it('sends the notice from the write that landed, and only that one', async () => {
    await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'signer-1',
      subject: 'a@example.com',
    });
    await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'signer-1',
      subject: 'a@example.com',
    });

    // The dedupe index is the idempotency guarantee for the mail as much as
    // for the row: a reconciler telling the same story twice mails once.
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        kind: 'recovery_key_added',
        subject: 'a@example.com',
      }),
      {},
    );
  });

  it('hands the notice what the recorder knew about a staged change', async () => {
    await service.recordSettingsChangeStaged('user-1', {
      changeIndex: 8n,
      subject: 'Dev1ce111',
      change: 'device',
    });

    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'settings_change_staged' }),
      { change: 'device' },
    );
  });

  it('records one staging per change however many services see it', async () => {
    // The service that staged it and the watcher that later finds it on chain
    // both record the same fact; the first one wins and the second is silent.
    await service.recordSettingsChangeStaged('user-1', {
      changeIndex: 8n,
      change: 'recovery_key',
    });
    const again = await service.recordSettingsChangeStaged('user-1', {
      changeIndex: '8',
    });
    await service.recordSettingsChangeStaged('user-1', { changeIndex: 9n });

    expect(again).toBeNull();
    expect(store.rows).toHaveLength(2);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('keeps both addresses on a contact rotation', async () => {
    const event = await service.recordContactEmailChanged('user-1', {
      changeIndex: 3n,
      previousEmail: 'old@example.com',
      nextEmail: 'new@example.com',
    });

    expect(event?.subject).toBe('new@example.com');
    expect(event?.previousSubject).toBe('old@example.com');
  });

  it('keeps the kinds the feed has no sentence for out of it', async () => {
    await service.recordSettingsChangeStaged('user-1', { changeIndex: 8n });
    await service.recordPasskeyEnrolled('user-1', { credentialId: 'cred-1' });
    await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'signer-1',
      subject: 'a@example.com',
    });

    const feed = await service.list('user-1', { limit: 10 });

    // The app parses the page strictly, so an unknown kind there would fail
    // the whole page rather than one row.
    expect(feed.map((event) => event.kind)).toEqual(['recovery_key_added']);
  });

  it('records a recovery key reaching the signer set', async () => {
    const event = await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'signer-1',
      subject: 'a@example.com',
    });

    expect(event?.kind).toBe('recovery_key_added');
    expect(event?.subject).toBe('a@example.com');
  });

  it('records the same fact once however often it is told', async () => {
    const first = await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'signer-1',
      subject: 'a@example.com',
    });
    const second = await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'signer-1',
      subject: 'a@example.com',
    });

    // The caller is a reconciler that runs again on every poll, so a second
    // telling is the normal case rather than an error.
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(store.rows).toHaveLength(1);
  });

  it('keeps adding and removing the same key apart', async () => {
    await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'signer-1',
      subject: 'a@example.com',
    });
    const removed = await service.recordRecoveryKeyRemoved('user-1', {
      signerId: 'signer-1',
      subject: 'a@example.com',
    });

    // Same signer, different fact. Deduping on the signer alone would swallow
    // the removal and leave the feed claiming the key is still there.
    expect(removed).not.toBeNull();
    expect(store.rows).toHaveLength(2);
  });

  it('treats a rename back to an earlier name as its own change', async () => {
    await service.recordWalletRenamed('user-1', {
      name: 'Gift',
      previous: 'Wallet',
    });
    const back = await service.recordWalletRenamed('user-1', {
      name: 'Wallet',
      previous: 'Gift',
    });

    expect(back).not.toBeNull();
    expect(store.rows).toHaveLength(2);
  });

  it('reads back newest first, within the window it was given', async () => {
    const at = (iso: string) => new Date(iso);
    await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'old',
      subject: 'old@example.com',
      occurredAt: at('2026-01-01T00:00:00Z'),
    });
    await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'mid',
      subject: 'mid@example.com',
      occurredAt: at('2026-06-01T00:00:00Z'),
    });
    await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'new',
      subject: 'new@example.com',
      occurredAt: at('2026-12-01T00:00:00Z'),
    });

    const windowed = await service.list('user-1', {
      limit: 10,
      before: at('2026-12-01T00:00:00Z'),
      after: at('2026-01-01T00:00:00Z'),
    });

    // The bounds are what keeps a merged feed in order: an event outside the
    // span this page covers belongs to a different page.
    expect(windowed.map((e) => e.subject)).toEqual(['mid@example.com']);
  });

  it('keeps one Consumer out of another Consumer feed', async () => {
    await service.recordRecoveryKeyAdded('user-1', {
      signerId: 'signer-1',
      subject: 'a@example.com',
    });

    expect(await service.list('user-2', { limit: 10 })).toEqual([]);
  });
});
