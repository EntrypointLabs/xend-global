import { createHash } from 'node:crypto';

import { EntrySessionInvalidError } from './entry-session.errors';
import {
  ENTRY_SESSION_TTL_MS,
  EntrySessionService,
} from './entry-session.service';
import type { EntrySessionRow, EntrySessionStore } from './entry-session.store';

/**
 * The credential behind a limited session. What matters is that it is
 * opaque, hashed at rest, dies on the clock with no way to extend it, and
 * dies at once when revoked or when the account behind it closes.
 */

function makeStore() {
  const sessions: EntrySessionRow[] = [];
  const accounts = new Map<
    string,
    { walletAddress: string; deleted: boolean }
  >();
  let next = 0;
  const store: EntrySessionStore = {
    insert(row) {
      const inserted: EntrySessionRow = {
        id: `entry-${++next}`,
        userId: row.userId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        revokedAt: null,
        createdAt: new Date(),
      };
      sessions.push(inserted);
      return Promise.resolve(inserted);
    },
    findLive(tokenHash, now) {
      const session = sessions.find(
        (row) =>
          row.tokenHash === tokenHash && !row.revokedAt && row.expiresAt > now,
      );
      const account = session && accounts.get(session.userId);
      if (!session || !account || account.deleted) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        session,
        userId: session.userId,
        walletAddress: account.walletAddress,
      });
    },
    revoke(id, now) {
      const session = sessions.find((row) => row.id === id);
      if (session && !session.revokedAt) session.revokedAt = now;
      return Promise.resolve();
    },
  };
  return { store, sessions, accounts };
}

function setUp() {
  const db = makeStore();
  db.accounts.set('user-1', { walletAddress: 'wallet-1', deleted: false });
  return { service: new EntrySessionService(db.store), db };
}

describe('EntrySessionService', () => {
  const issued = new Date('2026-08-30T10:00:00Z');

  it('mints an opaque token and stores only its hash', async () => {
    const { service, db } = setUp();

    const { entryToken, expiresAt } = await service.open('user-1', issued);

    expect(entryToken).toMatch(/^xentry_[A-Za-z0-9_-]{43}$/);
    expect(db.sessions).toHaveLength(1);
    expect(db.sessions[0].tokenHash).toBe(
      createHash('sha256').update(entryToken).digest('hex'),
    );
    expect(db.sessions[0].tokenHash).not.toContain(entryToken.slice(7));
    expect(new Date(expiresAt).getTime()).toBe(
      issued.getTime() + ENTRY_SESSION_TTL_MS,
    );
  });

  it('two sessions never share a token', async () => {
    const { service } = setUp();
    const a = await service.open('user-1');
    const b = await service.open('user-1');
    expect(a.entryToken).not.toBe(b.entryToken);
  });

  it('authenticates a live token as the entry tier', async () => {
    const { service, db } = setUp();
    const { entryToken } = await service.open('user-1', issued);

    await expect(service.authenticate(entryToken, issued)).resolves.toEqual({
      userId: 'user-1',
      walletAddress: 'wallet-1',
      tier: 'entry',
      entrySessionId: db.sessions[0].id,
    });
  });

  it('dies on the absolute clock, and use does not extend it', async () => {
    const { service } = setUp();
    const { entryToken } = await service.open('user-1', issued);

    const nearEnd = new Date(issued.getTime() + ENTRY_SESSION_TTL_MS - 1);
    await expect(
      service.authenticate(entryToken, nearEnd),
    ).resolves.toMatchObject({ tier: 'entry' });

    const late = new Date(issued.getTime() + ENTRY_SESSION_TTL_MS + 1);
    await expect(service.authenticate(entryToken, late)).rejects.toThrow(
      EntrySessionInvalidError,
    );
  });

  it('stops validating the moment it is revoked', async () => {
    const { service, db } = setUp();
    const { entryToken } = await service.open('user-1', issued);

    await service.revoke(db.sessions[0].id, issued);

    await expect(service.authenticate(entryToken, issued)).rejects.toThrow(
      EntrySessionInvalidError,
    );
  });

  it('stops validating when the account behind it closes', async () => {
    const { service, db } = setUp();
    const { entryToken } = await service.open('user-1', issued);
    db.accounts.set('user-1', { walletAddress: 'wallet-1', deleted: true });

    await expect(service.authenticate(entryToken, issued)).rejects.toThrow(
      EntrySessionInvalidError,
    );
  });

  it('refuses anything that is not one of its tokens', async () => {
    const { service, db } = setUp();
    await service.open('user-1', issued);

    await expect(service.authenticate('', issued)).rejects.toThrow(
      EntrySessionInvalidError,
    );
    await expect(
      service.authenticate('xentry_' + 'A'.repeat(43), issued),
    ).rejects.toThrow(EntrySessionInvalidError);
    await expect(
      service.authenticate(db.sessions[0].tokenHash, issued),
    ).rejects.toThrow(EntrySessionInvalidError);
    await expect(
      service.authenticate('xsign_' + 'A'.repeat(43), issued),
    ).rejects.toThrow(EntrySessionInvalidError);
    await expect(
      service.authenticate('eyJhbGciOiJIUzI1NiJ9.e30.x', issued),
    ).rejects.toThrow(EntrySessionInvalidError);
  });
});
