import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { AccountEventsService } from '../activity/account-events.service';
import { AccountChangeService } from './account-change.service';
import { SQUADS_ACCOUNT_STORE } from './account.interface';
import type { SquadsAccountRow, SquadsAccountStore } from './account.interface';

/** Often enough to matter against a 24-hour lock, rarely enough to be cheap. */
const WATCH_CRON = '0 */5 * * * *';

/**
 * Finds settings changes nobody told the Consumer about, and tells them.
 *
 * Without this the Settings time lock delays an attacker rather than stopping
 * one: two stolen signers stage a change, wait out the lock, and execute it,
 * and the window in which the Consumer could have rejected passes in silence.
 * The lock only buys anything if somebody is watching, and the Consumer is the
 * only party who knows whether they made the change.
 *
 * Polled rather than driven by a webhook because the trigger is a change to the
 * Settings account, which is not a transfer and so not something the activity
 * webhook is subscribed to.
 *
 * A change staged through our own endpoints was recorded, and announced, the
 * moment it was staged, and recording it again here is a no-op. What this
 * catches is everything else: a change that reached the chain without passing
 * through here gets its only notice from this loop.
 */
@Injectable()
export class AccountChangeWatcher {
  private readonly logger = new Logger(AccountChangeWatcher.name);

  constructor(
    private readonly changes: AccountChangeService,
    private readonly events: AccountEventsService,
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
  ) {}

  @Cron(WATCH_CRON)
  async tick(): Promise<void> {
    let accounts: SquadsAccountRow[];
    try {
      accounts = await this.store.listAll();
    } catch (err) {
      this.logger.warn('account_change.watch_failed', err);
      return;
    }

    for (const account of accounts) {
      // One Account's unreadable settings must not stop the rest being
      // checked: this is the notice that has to arrive.
      try {
        await this.check(account);
      } catch (err) {
        this.logger.warn(
          `account_change.check_failed userId=${account.userId}`,
          err,
        );
      }
    }
  }

  private async check(account: SquadsAccountRow): Promise<void> {
    const staged = await this.changes.pendingFor(account);
    if (!staged) return;

    // `selfInitiated` means the backend holds a recovery key row for this
    // index, so the only thing this can name is a recovery key change. Any
    // other change it finds is one nobody here staged, and the notice for
    // that says so rather than guessing.
    const written = await this.events.recordSettingsChangeStaged(
      account.userId,
      {
        changeIndex: staged.transactionIndex,
        change: staged.selfInitiated ? 'recovery_key' : undefined,
      },
    );
    if (written) {
      this.logger.warn(
        `account_change.found_unannounced userId=${account.userId} index=${staged.transactionIndex}`,
      );
    }
  }
}
