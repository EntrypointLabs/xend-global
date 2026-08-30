import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { SIGNUP_TOKEN_TTL_MS } from './signup.service';
import { SIGNUP_STORE, type SignupStore } from './signup.store';

const REAP_CRON = '0 */10 * * * *';

/**
 * Past the token's life plus the code's, so a row is only ever reaped once
 * nothing the Consumer is holding could still act on it.
 */
export const ABANDONED_AFTER_MS = SIGNUP_TOKEN_TTL_MS + 45 * 60 * 1000;

/**
 * Clears sign-ups that stopped before a passkey was created.
 *
 * A proved address with no Consumer behind it is a users row, a sealed
 * recovery signer and a spent token that nothing will ever read. Left alone
 * they accumulate, and the address stays refused to whoever tries it next.
 */
@Injectable()
export class SignupReaper {
  private readonly logger = new Logger(SignupReaper.name);

  constructor(@Inject(SIGNUP_STORE) private readonly store: SignupStore) {}

  @Cron(REAP_CRON)
  async tick(now = new Date()): Promise<void> {
    try {
      const removed = await this.store.deleteAbandonedBefore(
        new Date(now.getTime() - ABANDONED_AFTER_MS),
      );
      if (removed > 0) {
        this.logger.log(`signup.reaped count=${removed}`);
      }
    } catch (err) {
      this.logger.warn('signup.reap_failed', err);
    }
  }
}
