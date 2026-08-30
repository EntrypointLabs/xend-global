import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { RATE_COUNTER } from '../counters/rate-counter.interface';
import type { RateCounter } from '../counters/rate-counter.interface';
import { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import { RecoveryService } from '../recovery/recovery.service';
import { RecoveryGrantExpiredError } from '../recovery/recovery.errors';
import { EmailInUseError } from './auth.errors';
import {
  SignupTokenInvalidError,
  TooManySignupAttemptsError,
} from './signup.errors';
import { SIGNUP_STORE, type SignupStore, type UsersRow } from './signup.store';

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
 * The half of sign-up that happens before there is a passkey.
 *
 * Email proves the inbox and unlocks the recovery signer. It does not sign
 * anyone in: what comes out of here is a token that lets the passkey created
 * next bind to the row the code was proved against, and nothing else.
 *
 * Both endpoints are unauthenticated, so the two things they must never do
 * are say whether an address already has an Account, and let one caller bind
 * a row another caller proved.
 */
@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  constructor(
    @Inject(SIGNUP_STORE) private readonly store: SignupStore,
    @Inject(RATE_COUNTER) private readonly counter: RateCounter,
    private readonly challenges: RecoveryChallengeService,
    private readonly recovery: RecoveryService,
  ) {}

  /**
   * Mails a code to an address nobody has claimed.
   *
   * The answer is the same whether or not the address is already on an
   * Account. An address that is claimed gets no mail and the same shape back,
   * so the only way to learn what the platform knows about an inbox is to
   * read it.
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
    if (standing.kind === 'claimed') {
      this.logger.log('signup.challenge.claimed_address');
      return {
        sent: true,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      };
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
   * Turns a correct code into a proved address, a sealed recovery signer, and
   * the token that lets the next step bind a passkey to them.
   */
  async verifyEmailSignup(
    email: string,
    code: string,
    ip: string,
    now = new Date(),
  ): Promise<{ signupToken: string; expiresAt: string }> {
    await this.assertIpAllowance('verify', ip, MAX_VERIFIES_PER_IP_PER_HOUR);

    const standing = await this.store.standingOf(email);
    // Same refusal as a wrong code on a live challenge. A claimed address is
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
    return { signupToken: raw, expiresAt: row.expiresAt.toISOString() };
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
