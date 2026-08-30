import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { MAILER, type Mailer } from '../mail/mail.interface';
import {
  ChallengeAttemptsExhaustedError,
  InvalidRecoveryCodeError,
  NoRecoveryChallengeError,
  RecoveryGrantExpiredError,
  TooManyRecoveryCodesError,
} from './recovery.errors';
import {
  RECOVERY_CHALLENGE_STORE,
  type RecoveryChallengePurpose,
  type RecoveryChallengeRow,
  type RecoveryChallengeStore,
} from './recovery-challenge.store';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const CODE_DIGITS = 6;
const HASH_BYTES = 32;

/** Long enough to leave the app, read a mail client and come back. */
const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * How long a proved inbox stays proved.
 *
 * It has to cover proposing the change and collecting both approvals, and it
 * deliberately does not cover executing it: that waits out the 24 hour time
 * lock and needs only the signer already on the device.
 */
const GRANT_TTL_MS = 15 * 60 * 1000;

const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;

/**
 * Issues and checks the email code that releases S3.
 *
 * This is the second factor in the recovery model, and the only thing email
 * unlocks now that it is no longer a way in. What it authorises is narrow: the
 * backend producing the recovery signer's approval on a settings change the
 * Consumer's own device proposed. It cannot spend, because D5b keeps S3 out of
 * every policy, and it cannot act alone, because one signature is one vote
 * against a threshold of two.
 */
@Injectable()
export class RecoveryChallengeService {
  private readonly logger = new Logger(RecoveryChallengeService.name);

  constructor(
    @Inject(RECOVERY_CHALLENGE_STORE)
    private readonly store: RecoveryChallengeStore,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /**
   * Mails a fresh code, replacing any code still outstanding.
   *
   * The address comes from the caller rather than from the request, so the
   * only inbox a code can ever reach is the one already on the Account.
   */
  async issue(
    userId: string,
    email: string,
    purpose: RecoveryChallengePurpose,
    now = new Date(),
  ): Promise<{ expiresAt: Date }> {
    const recent = await this.store.countSince(
      userId,
      new Date(now.getTime() - 60 * 60 * 1000),
    );
    if (recent >= MAX_CODES_PER_HOUR) {
      throw new TooManyRecoveryCodesError(
        'too many codes requested in the last hour',
      );
    }

    await this.store.expireOpen(userId, purpose, now);

    const code = randomCode();
    const salt = randomBytes(16).toString('hex');
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

    await this.store.insert({
      userId,
      purpose,
      target: email.toLowerCase(),
      codeHash: (await scryptAsync(code, salt, HASH_BYTES)).toString('base64'),
      salt,
      expiresAt,
    });

    await this.mailer.send({
      to: email,
      subject: `${code} is your Xend code`,
      text:
        purpose === 'contact_verification'
          ? [
              `${code} confirms this address for your Xend account.`,
              '',
              'It expires in 10 minutes.',
              '',
              'This address is how we reach you, and it is what lets you move your',
              'account to a new phone if you lose this one. It is not a way to sign in:',
              'that is your passkey.',
            ].join('\n')
          : purpose === 'contact_rotation'
            ? [
                `${code} confirms this as the new address for your Xend account.`,
                '',
                'It expires in 10 minutes.',
                '',
                'Both keys on your phone approve the change, then it takes a day to go',
                'through. Until then the address already on your account stays in place,',
                'and we will write to it too.',
              ].join('\n')
            : [
                `${code} is your Xend recovery code.`,
                '',
                'It lets you move your account to a new phone, and it expires in 10 minutes.',
                'Moving a phone takes 24 hours to take effect, and we will tell you when it starts.',
                '',
                'If you did not ask for this, someone else knows your email address. The code',
                'alone cannot move your money: spending needs the phone you already have.',
              ].join('\n'),
    });

    // The code never reaches the log, and neither does the address.
    this.logger.log(
      `recovery.challenge.issued user=${userId} purpose=${purpose}`,
    );
    return { expiresAt };
  }

  /**
   * Checks a code and, on success, returns the grant id the recovery flow
   * carries for the next fifteen minutes.
   */
  async verify(
    userId: string,
    purpose: RecoveryChallengePurpose,
    code: string,
    now = new Date(),
  ): Promise<{ grantId: string; expiresAt: Date }> {
    const row = await this.store.findOpen(userId, purpose, now);
    if (!row) {
      throw new NoRecoveryChallengeError('no code is outstanding');
    }
    // Claimed rather than counted: guesses that arrive together must not share
    // one attempt between them.
    const claimed = await this.store.claimAttempt(row.id, MAX_ATTEMPTS);
    if (!claimed) {
      throw new ChallengeAttemptsExhaustedError(
        'that code has been guessed too many times',
      );
    }
    const attempts = claimed.attempts;

    const candidate = await scryptAsync(code, row.salt, HASH_BYTES);
    const expected = Buffer.from(row.codeHash, 'base64');
    if (
      candidate.length !== expected.length ||
      !timingSafeEqual(candidate, expected)
    ) {
      this.logger.warn(
        `recovery.challenge.wrong_code user=${userId} attempts=${attempts}`,
      );
      throw new InvalidRecoveryCodeError('that code is not right');
    }

    const verified = await this.store.updateById(row.id, { verifiedAt: now });
    this.logger.log(`recovery.challenge.verified user=${userId}`);
    return {
      grantId: verified.id,
      expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
    };
  }

  /**
   * The check every step of the recovery flow runs before it does anything.
   *
   * Throws rather than returning a boolean: there is exactly one correct
   * reaction to an invalid grant, and a caller that forgot to look at a
   * returned flag would sail past it.
   */
  async assertGrant(
    userId: string,
    grantId: string,
    purpose: RecoveryChallengePurpose,
    now = new Date(),
  ): Promise<RecoveryChallengeRow> {
    const row = await this.store.findById(grantId);
    if (
      !row ||
      row.userId !== userId ||
      row.purpose !== purpose ||
      !row.verifiedAt ||
      row.consumedAt
    ) {
      throw new RecoveryGrantExpiredError('that recovery session is not open');
    }
    if (now.getTime() - row.verifiedAt.getTime() > GRANT_TTL_MS) {
      throw new RecoveryGrantExpiredError('that recovery session has expired');
    }
    return row;
  }

  /**
   * Closes a grant once the signature it authorised is on chain.
   *
   * Not called on the way in. A submit that fails after signing would strand a
   * Consumer holding a code that no longer works, and the retry costs nothing:
   * the grant only ever authorises the one change already staged.
   */
  async consume(grantId: string, now = new Date()): Promise<void> {
    await this.store.updateById(grantId, { consumedAt: now });
    this.logger.log(`recovery.challenge.consumed grant=${grantId}`);
  }
}

/**
 * Uniform over the whole range. `randomInt` rejects rather than folding, so
 * the low codes are not fractionally likelier than the high ones the way
 * `random % 1000000` would make them.
 */
function randomCode(): string {
  return randomInt(0, 10 ** CODE_DIGITS)
    .toString()
    .padStart(CODE_DIGITS, '0');
}
