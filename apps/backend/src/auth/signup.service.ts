import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { RATE_COUNTER } from '../counters/rate-counter.interface';
import type { RateCounter } from '../counters/rate-counter.interface';
import { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import { RecoveryService } from '../recovery/recovery.service';
import {
  NoRecoveryChallengeError,
  RecoveryGrantExpiredError,
} from '../recovery/recovery.errors';
import { EmailInUseError } from './auth.errors';
import { EntrySessionService } from './entry-session.service';
import {
  SignupTokenInvalidError,
  TooManySignupAttemptsError,
} from './signup.errors';
import { SIGNUP_STORE, type SignupStore, type UsersRow } from './signup.store';

/**
 * What proving an inbox earns, decided only after the code came back right.
 *
 * `signup` is a row nothing has claimed: the token binds the passkey created
 * next. `entry` is an address already on an Account: a limited session that
 * can look and start a recovery, and never a signer. The response says which
 * only once the inbox is proved, so existence is not leaked to a stranger.
 */
export type EmailProofOutcome =
  | { kind: 'signup'; signupToken: string; expiresAt: string }
  | {
      kind: 'entry';
      entryToken: string;
      expiresAt: string;
      user: { id: string; email: string; walletAddress: string };
    };

const TOKEN_PREFIX = 'xsign_';
const TOKEN_BYTES = 32;

/**
 * Long enough to create a passkey and come back; short enough that a token
 * lifted from a device that was put down is worth little.
 */
export const SIGNUP_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Mirrors the code lifetime in RecoveryChallengeService, for the uniform answer. */
const CODE_TTL_MS = 10 * 60 * 1000;

const IP_WINDOW_SECONDS = 60 * 60;
const MAX_CHALLENGES_PER_IP_PER_HOUR = 20;
const MAX_VERIFIES_PER_IP_PER_HOUR = 60;

/**
 * The email door, for a stranger and for a Consumer alike.
 *
 * Email proves the inbox and unlocks the recovery signer. It does not sign
 * anyone in. For an address nobody holds, what comes out is a token that lets
 * the passkey created next bind to the row the code was proved against. For
 * an address already on an Account, it is a limited session that cannot
 * spend, cannot change the signer set and cannot enrol a passkey.
 *
 * Both endpoints are unauthenticated, so the two things they must never do
 * are say whether an address already has an Account before the inbox is
 * proved, and let one caller bind a row another caller proved.
 */
@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  constructor(
    @Inject(SIGNUP_STORE) private readonly store: SignupStore,
    @Inject(RATE_COUNTER) private readonly counter: RateCounter,
    private readonly challenges: RecoveryChallengeService,
    private readonly recovery: RecoveryService,
    private readonly entry: EntrySessionService,
  ) {}

  /**
   * Mails a code to the address, whatever it is to the platform.
   *
   * The answer is the same whether or not the address is already on an
   * Account, and so is the mail: a code goes out either way, minted for the
   * purpose the address can actually use. The only address that gets no mail
   * is one on a closed account, and it still gets the same shape back.
   */
  async startEmailSignup(
    email: string,
    ip: string,
    now = new Date(),
  ): Promise<{ sent: true; expiresAt: string }> {
    await this.assertIpAllowance(
      'challenge',
      ip,
      MAX_CHALLENGES_PER_IP_PER_HOUR,
    );

    const standing = await this.store.standingOf(email);
    if (standing.kind === 'closed') {
      this.logger.log('signup.challenge.closed_address');
      return {
        sent: true,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      };
    }
    if (standing.kind === 'claimed') {
      const { expiresAt } = await this.challenges.issue(
        standing.user.id,
        email,
        'entry_session',
        now,
      );
      return { sent: true, expiresAt: expiresAt.toISOString() };
    }

    let user: UsersRow;
    if (standing.kind === 'pending') {
      user = standing.user;
      await this.store.touchUser(user.id);
    } else {
      user = await this.store.createPendingUser();
    }

    const { expiresAt } = await this.challenges.issue(
      user.id,
      email,
      'contact_verification',
      now,
    );
    return { sent: true, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Turns a correct code into what the address earns: for a row nothing has
   * claimed, a proved address, a sealed recovery signer and the token that
   * binds the passkey created next; for an Account, an entry session.
   */
  async verifyEmailSignup(
    email: string,
    code: string,
    ip: string,
    now = new Date(),
  ): Promise<EmailProofOutcome> {
    await this.assertIpAllowance('verify', ip, MAX_VERIFIES_PER_IP_PER_HOUR);

    const standing = await this.store.standingOf(email);
    if (standing.kind === 'claimed') {
      return this.openEntrySession(
        standing.user,
        standing.walletAddress,
        email,
        code,
        now,
      );
    }
    // Same refusal as a wrong code on a live challenge. A closed address is
    // not a case this may name.
    if (standing.kind !== 'pending') {
      throw new RecoveryGrantExpiredError('that code is not right');
    }
    const user = standing.user;

    const { grantId } = await this.challenges.verify(
      user.id,
      'contact_verification',
      code,
      now,
    );
    const grant = await this.challenges.assertGrant(
      user.id,
      grantId,
      'contact_verification',
      now,
    );
    if (grant.target !== email) {
      throw new RecoveryGrantExpiredError(
        'that code was sent to a different address',
      );
    }

    if (user.email !== email) {
      try {
        await this.store.setEmail(user.id, email);
      } catch (err) {
        // The unique index is what settles a race with an Account that took
        // the address between the code going out and coming back. The
        // Consumer here has proved the inbox, so naming the clash tells them
        // nothing about it they could not learn by signing in with it.
        if (pgErrorCode(err) === '23505') {
          throw new EmailInUseError('that email is already on another account');
        }
        throw err;
      }
    }

    // Minted against the address the moment it is proved, so the recovery
    // signer exists before there is anything for it to recover. Idempotent:
    // a Consumer who proves the same inbox twice keeps the signer they had.
    await this.recovery.ensureEmailSigner(user.id, email);
    await this.challenges.consume(grantId, now);

    const raw = mintToken();
    await this.store.expireTokens(user.id, now);
    const row = await this.store.insertToken({
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(now.getTime() + SIGNUP_TOKEN_TTL_MS),
    });

    this.logger.log(`signup.email.verified user=${user.id}`);
    return {
      kind: 'signup',
      signupToken: raw,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /**
   * The code was minted for this purpose and no other, so a sign-up code
   * guessed against a claimed address, or the other way round, is a wrong
   * code. Nothing here touches a signer: the session it opens holds none.
   */
  private async openEntrySession(
    user: UsersRow,
    walletAddress: string,
    email: string,
    code: string,
    now: Date,
  ): Promise<EmailProofOutcome> {
    let grantId: string;
    try {
      ({ grantId } = await this.challenges.verify(
        user.id,
        'entry_session',
        code,
        now,
      ));
    } catch (err) {
      // An address nobody asked a code for answers the same whether or not
      // it is on an Account; the difference is what a stranger is probing for.
      if (err instanceof NoRecoveryChallengeError) {
        throw new RecoveryGrantExpiredError('that code is not right');
      }
      throw err;
    }
    const grant = await this.challenges.assertGrant(
      user.id,
      grantId,
      'entry_session',
      now,
    );
    if (grant.target !== email) {
      throw new RecoveryGrantExpiredError(
        'that code was sent to a different address',
      );
    }
    await this.challenges.consume(grantId, now);

    const opened = await this.entry.open(user.id, now);
    this.logger.log(`signup.entry.opened user=${user.id}`);
    return {
      kind: 'entry',
      entryToken: opened.entryToken,
      expiresAt: opened.expiresAt,
      user: { id: user.id, email, walletAddress },
    };
  }

  /**
   * Spends a sign-up token and returns the row it may bind.
   *
   * Spent before anything else is checked, so a token that reaches this
   * method never validates twice no matter how the rest of the exchange
   * goes. A Consumer whose exchange failed afterwards proves the inbox again,
   * which costs a code and nothing else.
   */
  async claimSignupToken(raw: string, now = new Date()): Promise<UsersRow> {
    if (!raw.startsWith(TOKEN_PREFIX)) {
      throw new SignupTokenInvalidError('that sign-up token is not valid');
    }
    const claimed = await this.store.claimToken(hashToken(raw), now);
    if (!claimed) {
      throw new SignupTokenInvalidError('that sign-up token is not valid');
    }
    const user = await this.store.findPendingUser(claimed.userId);
    if (!user) {
      throw new SignupTokenInvalidError('that sign-up token is not valid');
    }
    return user;
  }

  private async assertIpAllowance(
    action: 'challenge' | 'verify',
    ip: string,
    max: number,
  ): Promise<void> {
    const hour = Math.floor(Date.now() / (IP_WINDOW_SECONDS * 1000));
    const { count } = await this.counter.increment(
      `signup:${action}:ip:${ip}:hour:${hour}`,
      '0',
      IP_WINDOW_SECONDS,
    );
    if (count > max) {
      this.logger.warn(`signup.${action}.ip_limited`);
      throw new TooManySignupAttemptsError(
        'too many sign-up attempts from this network; try again later',
      );
    }
  }
}

function mintToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Postgres SQLSTATE, surfaced by node-postgres directly or as a cause. */
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
