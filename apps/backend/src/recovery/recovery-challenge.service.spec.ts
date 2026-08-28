import { RecoveryChallengeService } from './recovery-challenge.service';
import type {
  NewRecoveryChallenge,
  RecoveryChallengePurpose,
  RecoveryChallengeRow,
  RecoveryChallengeStore,
} from './recovery-challenge.store';
import type { Mailer, OutgoingMail } from '../mail/mail.interface';
import {
  ChallengeAttemptsExhaustedError,
  InvalidRecoveryCodeError,
  NoRecoveryChallengeError,
  RecoveryGrantExpiredError,
  TooManyRecoveryCodesError,
} from './recovery.errors';

/**
 * The email code is the second factor on the only flow that opens S3, so the
 * rules worth pinning are the ones that decide how much an attacker holding
 * the passkey can do with guesses and with time.
 */

const USER = 'user-1';
const EMAIL = 'consumer@example.com';
const PURPOSE: RecoveryChallengePurpose = 'device_rotation';

function makeStore() {
  const rows: RecoveryChallengeRow[] = [];
  let next = 0;

  const store: RecoveryChallengeStore = {
    insert(row: NewRecoveryChallenge) {
      const stored = {
        id: `challenge-${++next}`,
        userId: row.userId,
        purpose: row.purpose,
        codeHash: row.codeHash,
        salt: row.salt,
        expiresAt: row.expiresAt,
        attempts: row.attempts ?? 0,
        verifiedAt: row.verifiedAt ?? null,
        consumedAt: row.consumedAt ?? null,
        createdAt: new Date(),
      } as RecoveryChallengeRow;
      rows.push(stored);
      return Promise.resolve(stored);
    },
    findOpen(userId, purpose, now) {
      const open = rows
        .filter(
          (row) =>
            row.userId === userId &&
            row.purpose === purpose &&
            !row.consumedAt &&
            row.expiresAt > now,
        )
        .at(-1);
      return Promise.resolve(open ?? null);
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

  return { store, rows };
}

function makeMailer() {
  const sent: OutgoingMail[] = [];
  const mailer: Mailer = {
    send(mail) {
      sent.push(mail);
      return Promise.resolve();
    },
  };
  return { mailer, sent };
}

/** The code as the Consumer would read it out of the mail. */
function codeFrom(sent: OutgoingMail[]): string {
  const match = /(\d{6})/.exec(sent.at(-1)?.subject ?? '');
  if (!match) throw new Error('no code in the mail');
  return match[1];
}

function setUp() {
  const { store, rows } = makeStore();
  const { mailer, sent } = makeMailer();
  return {
    service: new RecoveryChallengeService(store, mailer),
    rows,
    sent,
  };
}

describe('RecoveryChallengeService', () => {
  it('mails a code to the address it is given and stores only its hash', async () => {
    const { service, rows, sent } = setUp();

    await service.issue(USER, EMAIL, PURPOSE);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
    const code = codeFrom(sent);
    expect(rows[0].codeHash).not.toContain(code);
    expect(rows[0].salt).not.toContain(code);
  });

  it('accepts the right code and refuses a wrong one', async () => {
    const { service, sent } = setUp();
    await service.issue(USER, EMAIL, PURPOSE);
    const code = codeFrom(sent);

    const wrong = code === '000000' ? '111111' : '000000';
    await expect(service.verify(USER, PURPOSE, wrong)).rejects.toBeInstanceOf(
      InvalidRecoveryCodeError,
    );

    const { grantId } = await service.verify(USER, PURPOSE, code);
    expect(grantId).toBeTruthy();
  });

  it('stops guessing after five wrong codes', async () => {
    const { service, sent } = setUp();
    await service.issue(USER, EMAIL, PURPOSE);
    const code = codeFrom(sent);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(service.verify(USER, PURPOSE, wrong)).rejects.toBeInstanceOf(
        InvalidRecoveryCodeError,
      );
    }

    // Even the right code is refused now. Exhausting the attempts burns the
    // challenge rather than the guess, so the answer is a new code.
    await expect(service.verify(USER, PURPOSE, code)).rejects.toBeInstanceOf(
      ChallengeAttemptsExhaustedError,
    );
  });

  it('invalidates the previous code when a new one is issued', async () => {
    const { service, sent } = setUp();
    await service.issue(USER, EMAIL, PURPOSE);
    const first = codeFrom(sent);

    await service.issue(USER, EMAIL, PURPOSE);
    const second = codeFrom(sent);

    // Two live codes would double the guessing surface against one attempt cap.
    await expect(service.verify(USER, PURPOSE, first)).rejects.toBeInstanceOf(
      InvalidRecoveryCodeError,
    );
    const { grantId } = await service.verify(USER, PURPOSE, second);
    expect(grantId.length).toBeGreaterThan(0);
  });

  it('refuses a sixth code within the hour', async () => {
    const { service } = setUp();
    for (let i = 0; i < 5; i++) await service.issue(USER, EMAIL, PURPOSE);

    await expect(service.issue(USER, EMAIL, PURPOSE)).rejects.toBeInstanceOf(
      TooManyRecoveryCodesError,
    );
  });

  it('refuses a code that has expired', async () => {
    const { service, sent } = setUp();
    const issuedAt = new Date('2026-08-28T10:00:00Z');
    await service.issue(USER, EMAIL, PURPOSE, issuedAt);
    const code = codeFrom(sent);

    const elevenMinutesLater = new Date(issuedAt.getTime() + 11 * 60 * 1000);
    await expect(
      service.verify(USER, PURPOSE, code, elevenMinutesLater),
    ).rejects.toBeInstanceOf(NoRecoveryChallengeError);
  });

  describe('the grant', () => {
    async function verified() {
      const { service, sent } = setUp();
      const at = new Date('2026-08-28T10:00:00Z');
      await service.issue(USER, EMAIL, PURPOSE, at);
      const { grantId } = await service.verify(
        USER,
        PURPOSE,
        codeFrom(sent),
        at,
      );
      return { service, grantId, at };
    }

    it('holds for fifteen minutes and no longer', async () => {
      const { service, grantId, at } = await verified();

      await expect(
        service.assertGrant(
          USER,
          grantId,
          PURPOSE,
          new Date(at.getTime() + 14 * 60 * 1000),
        ),
      ).resolves.toBeTruthy();

      await expect(
        service.assertGrant(
          USER,
          grantId,
          PURPOSE,
          new Date(at.getTime() + 16 * 60 * 1000),
        ),
      ).rejects.toBeInstanceOf(RecoveryGrantExpiredError);
    });

    it('belongs to one Consumer', async () => {
      const { service, grantId, at } = await verified();

      await expect(
        service.assertGrant('someone-else', grantId, PURPOSE, at),
      ).rejects.toBeInstanceOf(RecoveryGrantExpiredError);
    });

    it('is refused once consumed', async () => {
      const { service, grantId, at } = await verified();
      await service.consume(grantId, at);

      await expect(
        service.assertGrant(USER, grantId, PURPOSE, at),
      ).rejects.toBeInstanceOf(RecoveryGrantExpiredError);
    });

    it('is refused before the code is ever checked', async () => {
      const { service, rows, sent } = setUp();
      await service.issue(USER, EMAIL, PURPOSE);
      expect(sent).toHaveLength(1);

      // The row exists from the moment the code is mailed, so an id guessed or
      // leaked from it must be worth nothing until somebody proves the inbox.
      await expect(
        service.assertGrant(USER, rows[0].id, PURPOSE),
      ).rejects.toBeInstanceOf(RecoveryGrantExpiredError);
    });
  });
});
