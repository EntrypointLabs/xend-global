import { createHash } from 'node:crypto';

import type { RateCounter } from '../counters/rate-counter.interface';
import type { Mailer, OutgoingMail } from '../mail/mail.interface';
import { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import type {
  NewRecoveryChallenge,
  RecoveryChallengeRow,
  RecoveryChallengeStore,
} from '../recovery/recovery-challenge.store';
import {
  InvalidRecoveryCodeError,
  RecoveryGrantExpiredError,
  TooManyRecoveryCodesError,
} from '../recovery/recovery.errors';
import type { RecoveryService } from '../recovery/recovery.service';
import { EmailInUseError } from './auth.errors';
import {
  SignupTokenInvalidError,
  TooManySignupAttemptsError,
} from './signup.errors';
import { SIGNUP_TOKEN_TTL_MS, SignupService } from './signup.service';
import type {
  AddressStanding,
  SignupStore,
  SignupTokenRow,
  UsersRow,
} from './signup.store';

/**
 * The two unauthenticated endpoints of sign-up, and the token that ties them
 * to the exchange. What is worth pinning is what a stranger can learn or
 * take: whether an address has an Account, and whether a row somebody else
 * proved can be bound by anyone but them.
 */

const EMAIL = 'new@example.com';
const IP = '203.0.113.7';

interface FakeAccount {
  userId: string;
}

/**
 * The tables sign-up touches, reduced to the rules the store encodes: a
 * pending row is one with no binding, and an address belongs to whichever
 * row holds it or, before it is proved, whichever challenge named it.
 */
function makeStore() {
  const users: UsersRow[] = [];
  const bindings: FakeAccount[] = [];
  const tokens: SignupTokenRow[] = [];
  const challengeTargets: { userId: string; target: string; at: Date }[] = [];
  let clashOnWrite = false;
  let seq = 0;

  const bound = (userId: string) =>
    bindings.some((binding) => binding.userId === userId);

  const store: SignupStore = {
    standingOf(email): Promise<AddressStanding> {
      const onRow = users.find((user) => user.email === email);
      if (onRow) {
        if (bound(onRow.id) || onRow.deletedAt) {
          return Promise.resolve({ kind: 'claimed' });
        }
        return Promise.resolve({ kind: 'pending', user: onRow });
      }
      const named = challengeTargets
        .filter((challenge) => challenge.target === email)
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .map((challenge) => users.find((user) => user.id === challenge.userId))
        .find((user) => user && !user.email && !user.deletedAt);
      if (named && !bound(named.id)) {
        return Promise.resolve({ kind: 'pending', user: named });
      }
      return Promise.resolve({ kind: 'free' });
    },
    createPendingUser() {
      const user: UsersRow = {
        id: `user-${++seq}`,
        email: null,
        notificationsEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      users.push(user);
      return Promise.resolve(user);
    },
    touchUser(userId) {
      const user = users.find((candidate) => candidate.id === userId);
      if (user) user.updatedAt = new Date();
      return Promise.resolve();
    },
    setEmail(userId, email) {
      if (
        clashOnWrite ||
        users.some((user) => user.email === email && user.id !== userId)
      ) {
        return Promise.reject(
          Object.assign(new Error('duplicate key value'), { code: '23505' }),
        );
      }
      const user = users.find((candidate) => candidate.id === userId);
      if (!user) throw new Error(`no user ${userId}`);
      user.email = email;
      user.updatedAt = new Date();
      return Promise.resolve();
    },
    insertToken(row) {
      const inserted: SignupTokenRow = {
        id: `token-${++seq}`,
        userId: row.userId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        consumedAt: null,
        createdAt: new Date(),
      };
      tokens.push(inserted);
      return Promise.resolve(inserted);
    },
    expireTokens(userId, now) {
      for (const token of tokens) {
        if (
          token.userId === userId &&
          !token.consumedAt &&
          token.expiresAt > now
        ) {
          token.expiresAt = now;
        }
      }
      return Promise.resolve();
    },
    claimToken(tokenHash, now) {
      const token = tokens.find(
        (candidate) =>
          candidate.tokenHash === tokenHash &&
          !candidate.consumedAt &&
          candidate.expiresAt > now,
      );
      if (!token) return Promise.resolve(null);
      token.consumedAt = now;
      return Promise.resolve(token);
    },
    findPendingUser(userId) {
      const user = users.find((candidate) => candidate.id === userId);
      if (!user || !user.email || user.deletedAt || bound(user.id)) {
        return Promise.resolve(null);
      }
      return Promise.resolve(user);
    },
    deleteAbandonedBefore(before) {
      const stale = users.filter(
        (user) => !bound(user.id) && user.updatedAt < before,
      );
      for (const user of stale) users.splice(users.indexOf(user), 1);
      return Promise.resolve(stale.length);
    },
  };

  return {
    store,
    users,
    bindings,
    tokens,
    nameTarget(userId: string, target: string) {
      challengeTargets.push({ userId, target, at: new Date() });
    },
    /** Models an Account taking the address after the standing was read. */
    clashOnNextWrite() {
      clashOnWrite = true;
    },
  };
}

/** The real challenge service over an in-memory store, so the code is real too. */
function makeChallenges(onIssue: (userId: string, target: string) => void) {
  const rows: RecoveryChallengeRow[] = [];
  let next = 0;
  const store: RecoveryChallengeStore = {
    insert(row: NewRecoveryChallenge) {
      const stored = {
        id: `challenge-${++next}`,
        userId: row.userId,
        purpose: row.purpose,
        target: row.target ?? null,
        codeHash: row.codeHash,
        salt: row.salt,
        expiresAt: row.expiresAt,
        attempts: row.attempts ?? 0,
        verifiedAt: row.verifiedAt ?? null,
        consumedAt: row.consumedAt ?? null,
        createdAt: new Date(),
      } as RecoveryChallengeRow;
      rows.push(stored);
      onIssue(row.userId, row.target ?? '');
      return Promise.resolve(stored);
    },
    findOpen(userId, purpose, now) {
      return Promise.resolve(
        rows
          .filter(
            (row) =>
              row.userId === userId &&
              row.purpose === purpose &&
              !row.consumedAt &&
              row.expiresAt > now,
          )
          .at(-1) ?? null,
      );
    },
    findById(id) {
      return Promise.resolve(rows.find((row) => row.id === id) ?? null);
    },
    countSince(userId, since) {
      return Promise.resolve(
        rows.filter((row) => row.userId === userId && row.createdAt > since)
          .length,
      );
    },
    claimAttempt(id, maxAttempts) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row || row.attempts >= maxAttempts) return Promise.resolve(null);
      row.attempts += 1;
      return Promise.resolve(row);
    },
    updateById(id, patch) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`no challenge ${id}`);
      Object.assign(row, patch);
      return Promise.resolve(row);
    },
    expireOpen(userId, purpose, now) {
      for (const row of rows) {
        if (
          row.userId === userId &&
          row.purpose === purpose &&
          !row.consumedAt &&
          row.expiresAt > now
        ) {
          row.expiresAt = now;
        }
      }
      return Promise.resolve();
    },
  };

  const sent: OutgoingMail[] = [];
  const mailer: Mailer = {
    send(mail) {
      sent.push(mail);
      return Promise.resolve();
    },
  };
  return { challenges: new RecoveryChallengeService(store, mailer), sent };
}

function makeCounter() {
  const counts = new Map<string, number>();
  const counter: RateCounter = {
    increment(key) {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Promise.resolve({ count, totalRaw: '0' });
    },
    peek(key) {
      return Promise.resolve({ count: counts.get(key) ?? 0, totalRaw: '0' });
    },
    clear(key) {
      counts.delete(key);
      return Promise.resolve();
    },
  };
  return { counter, counts };
}

function codeFrom(sent: OutgoingMail[]): string {
  const match = /(\d{6})/.exec(sent.at(-1)?.subject ?? '');
  if (!match) throw new Error('no code in the mail');
  return match[1];
}

function setUp() {
  const db = makeStore();
  const { challenges, sent } = makeChallenges((userId, target) =>
    db.nameTarget(userId, target),
  );
  const { counter, counts } = makeCounter();
  const minted: { userId: string; email: string }[] = [];
  const recovery = {
    ensureEmailSigner: (userId: string, email: string) => {
      minted.push({ userId, email });
      return Promise.resolve({ address: `signer-for-${userId}` });
    },
  } as unknown as RecoveryService;
  const service = new SignupService(db.store, counter, challenges, recovery);
  return { service, db, sent, counts, minted };
}

/** Runs the whole email step and hands back the token the app would hold. */
async function proveAddress(
  ctx: ReturnType<typeof setUp>,
  email = EMAIL,
  now = new Date(),
) {
  await ctx.service.startEmailSignup(email, IP, now);
  return ctx.service.verifyEmailSignup(email, codeFrom(ctx.sent), IP, now);
}

describe('SignupService.startEmailSignup', () => {
  it('creates a pending row and mails it a code', async () => {
    const ctx = setUp();

    const answer = await ctx.service.startEmailSignup(EMAIL, IP);

    expect(answer.sent).toBe(true);
    expect(ctx.db.users).toHaveLength(1);
    // Not written until the code comes back: the row holds nothing a
    // stranger could type.
    expect(ctx.db.users[0].email).toBeNull();
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].to).toBe(EMAIL);
  });

  it('reuses the pending row on a second request rather than making another', async () => {
    const ctx = setUp();

    await ctx.service.startEmailSignup(EMAIL, IP);
    await ctx.service.startEmailSignup(EMAIL, IP);

    expect(ctx.db.users).toHaveLength(1);
    expect(ctx.sent).toHaveLength(2);
  });

  it('answers a claimed address exactly like a free one, and mails nothing', async () => {
    const ctx = setUp();
    const now = new Date('2026-08-30T10:00:00Z');
    const { signupToken } = await proveAddress(ctx, 'taken@example.com', now);
    ctx.db.bindings.push({
      userId: (await ctx.service.claimSignupToken(signupToken, now)).id,
    });
    const before = ctx.sent.length;

    const claimed = await ctx.service.startEmailSignup(
      'taken@example.com',
      IP,
      now,
    );
    const free = await ctx.service.startEmailSignup(
      'free@example.com',
      IP,
      now,
    );

    // Same keys, same shape, same expiry. Nothing in the body says which is
    // which, and no row was made for the claimed one.
    expect(Object.keys(claimed)).toEqual(Object.keys(free));
    expect(claimed.sent).toBe(free.sent);
    expect(claimed.expiresAt).toBe(free.expiresAt);
    expect(ctx.sent.length - before).toBe(1);
    expect(ctx.sent.at(-1)?.to).toBe('free@example.com');
  });

  it('keeps the per-address cap the challenge service already enforces', async () => {
    const ctx = setUp();

    for (let i = 0; i < 5; i++) {
      await ctx.service.startEmailSignup(EMAIL, IP);
    }

    await expect(ctx.service.startEmailSignup(EMAIL, IP)).rejects.toThrow(
      TooManyRecoveryCodesError,
    );
  });

  it('caps one network across every address it tries', async () => {
    const ctx = setUp();

    for (let i = 0; i < 20; i++) {
      await ctx.service.startEmailSignup(`victim-${i}@example.com`, IP);
    }

    await expect(
      ctx.service.startEmailSignup('victim-20@example.com', IP),
    ).rejects.toThrow(TooManySignupAttemptsError);
    // Another network is not caught by it.
    await expect(
      ctx.service.startEmailSignup('victim-20@example.com', '198.51.100.1'),
    ).resolves.toMatchObject({ sent: true });
  });
});

describe('SignupService.verifyEmailSignup', () => {
  it('proves the address, mints the recovery signer and issues a token', async () => {
    const ctx = setUp();

    const { signupToken, expiresAt } = await proveAddress(ctx);

    expect(signupToken).toMatch(/^xsign_[A-Za-z0-9_-]{43}$/);
    expect(ctx.db.users[0].email).toBe(EMAIL);
    expect(ctx.minted).toEqual([{ userId: ctx.db.users[0].id, email: EMAIL }]);
    // Only the hash is at rest.
    expect(ctx.db.tokens).toHaveLength(1);
    expect(ctx.db.tokens[0].tokenHash).toBe(
      createHash('sha256').update(signupToken).digest('hex'),
    );
    expect(ctx.db.tokens[0].tokenHash).not.toContain(signupToken.slice(6));
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a wrong code', async () => {
    const ctx = setUp();
    await ctx.service.startEmailSignup(EMAIL, IP);
    const wrong = codeFrom(ctx.sent) === '000000' ? '000001' : '000000';

    await expect(
      ctx.service.verifyEmailSignup(EMAIL, wrong, IP),
    ).rejects.toThrow(InvalidRecoveryCodeError);
    expect(ctx.db.tokens).toHaveLength(0);
    expect(ctx.minted).toHaveLength(0);
  });

  it('refuses a code for an address that was never asked for one', async () => {
    const ctx = setUp();

    await expect(
      ctx.service.verifyEmailSignup(EMAIL, '123456', IP),
    ).rejects.toThrow(RecoveryGrantExpiredError);
  });

  it('refuses the same way for a claimed address, so a guess learns nothing', async () => {
    const ctx = setUp();
    const { signupToken } = await proveAddress(ctx, 'taken@example.com');
    ctx.db.bindings.push({
      userId: (await ctx.service.claimSignupToken(signupToken)).id,
    });

    await expect(
      ctx.service.verifyEmailSignup('taken@example.com', '123456', IP),
    ).rejects.toThrow(RecoveryGrantExpiredError);
  });

  it('names the clash when an Account took the address mid-flight', async () => {
    const ctx = setUp();
    await ctx.service.startEmailSignup(EMAIL, IP);
    const code = codeFrom(ctx.sent);
    ctx.db.clashOnNextWrite();

    // The Consumer here holds the inbox, so telling them it is on an Account
    // gives away nothing they could not learn by signing in with it.
    await expect(
      ctx.service.verifyEmailSignup(EMAIL, code, IP),
    ).rejects.toThrow(EmailInUseError);
    expect(ctx.db.tokens).toHaveLength(0);
    expect(ctx.minted).toHaveLength(0);
  });

  it('proving the inbox again keeps the signer and replaces the token', async () => {
    const ctx = setUp();
    const first = await proveAddress(ctx);
    const second = await proveAddress(ctx);

    expect(second.signupToken).not.toBe(first.signupToken);
    expect(ctx.db.users).toHaveLength(1);
    // The signer service is asked twice and is idempotent; nothing here
    // mints around it.
    expect(ctx.minted).toHaveLength(2);
    await expect(
      ctx.service.claimSignupToken(first.signupToken),
    ).rejects.toThrow(SignupTokenInvalidError);
    await expect(
      ctx.service.claimSignupToken(second.signupToken),
    ).resolves.toMatchObject({ email: EMAIL });
  });
});

describe('SignupService.claimSignupToken', () => {
  it('spends a live token once and returns the row it binds', async () => {
    const ctx = setUp();
    const { signupToken } = await proveAddress(ctx);

    const user = await ctx.service.claimSignupToken(signupToken);

    expect(user.id).toBe(ctx.db.users[0].id);
    expect(user.email).toBe(EMAIL);
    expect(ctx.db.tokens[0].consumedAt).not.toBeNull();
  });

  it('refuses a token that was already spent', async () => {
    const ctx = setUp();
    const { signupToken } = await proveAddress(ctx);
    await ctx.service.claimSignupToken(signupToken);

    await expect(ctx.service.claimSignupToken(signupToken)).rejects.toThrow(
      SignupTokenInvalidError,
    );
  });

  it('refuses a token past its lifetime', async () => {
    const ctx = setUp();
    const issued = new Date('2026-08-30T10:00:00Z');
    const { signupToken } = await proveAddress(ctx, EMAIL, issued);

    const late = new Date(issued.getTime() + SIGNUP_TOKEN_TTL_MS + 1);
    await expect(
      ctx.service.claimSignupToken(signupToken, late),
    ).rejects.toThrow(SignupTokenInvalidError);
  });

  it('refuses a token nobody issued', async () => {
    const ctx = setUp();
    await proveAddress(ctx);

    await expect(
      ctx.service.claimSignupToken('xsign_' + 'A'.repeat(43)),
    ).rejects.toThrow(SignupTokenInvalidError);
    await expect(ctx.service.claimSignupToken('')).rejects.toThrow(
      SignupTokenInvalidError,
    );
    await expect(
      ctx.service.claimSignupToken(ctx.db.tokens[0].tokenHash),
    ).rejects.toThrow(SignupTokenInvalidError);
  });

  it('refuses a token whose row has since been bound', async () => {
    const ctx = setUp();
    const { signupToken } = await proveAddress(ctx);
    ctx.db.bindings.push({ userId: ctx.db.users[0].id });

    await expect(ctx.service.claimSignupToken(signupToken)).rejects.toThrow(
      SignupTokenInvalidError,
    );
  });

  it('lets two racing exchanges spend a token exactly once', async () => {
    const ctx = setUp();
    const { signupToken } = await proveAddress(ctx);

    const outcomes = await Promise.allSettled([
      ctx.service.claimSignupToken(signupToken),
      ctx.service.claimSignupToken(signupToken),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
  });
});
