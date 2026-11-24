import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { AccountEventsService } from '../activity/account-events.service';
import { SettingsActivitySignal } from '../activity/settings-activity.signal';
import { AccountChangeService } from './account-change.service';
import { SQUADS_ACCOUNT_STORE } from './account.interface';
import type { SquadsAccountRow, SquadsAccountStore } from './account.interface';

/**
 * The backstop for a webhook delivery that never came. Hourly leaves 23 of
 * the lock's 24 hours to react, and lets an idle database sleep between runs.
 */
const WATCH_CRON = '0 0 * * * *';

/**
 * Finds settings changes nobody told the Consumer about, and tells them.
 *
 * Without this the Settings time lock delays an attacker rather than stopping
 * one: two stolen signers stage a change, wait out the lock, and execute it,
 * and the window in which the Consumer could have rejected passes in silence.
 * The lock only buys anything if somebody is watching, and the Consumer is the
 * only party who knows whether they made the change.
 *
 * Driven by the activity webhook: each Account's Settings address is
 * subscribed alongside its vault, so a transaction that stages or votes on a
 * change is delivered here and checked straight away. An hourly sweep of every
 * Account covers a delivery Helius dropped, or an Account whose subscription
 * failed when it was created.
 *
 * A change staged through our own endpoints was recorded, and announced, the
 * moment it was staged, and recording it again here is a no-op. What this
 * catches is everything else: a change that reached the chain without passing
 * through here gets its only notice from this loop.
 */
@Injectable()
export class AccountChangeWatcher implements OnModuleInit {
  private readonly logger = new Logger(AccountChangeWatcher.name);
  private readonly checking = new Set<string>();

  constructor(
    private readonly changes: AccountChangeService,
    private readonly events: AccountEventsService,
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    private readonly settingsActivity: SettingsActivitySignal,
  ) {}

  onModuleInit(): void {
    this.settingsActivity.listen((addresses) =>
      this.onSettingsActivity(addresses),
    );
  }

  /** Check the Accounts whose Settings a delivered transaction touched. */
  async onSettingsActivity(addresses: string[]): Promise<void> {
    const accounts = await this.store.findBySettingsAddresses(addresses);
    await this.checkEach(accounts);
  }

  @Cron(WATCH_CRON)
  async tick(): Promise<void> {
    let accounts: SquadsAccountRow[];
    try {
      accounts = await this.store.listAll();
    } catch (err) {
      this.logger.warn('account_change.watch_failed', err);
      return;
    }

    await this.checkEach(accounts);
  }

  private async checkEach(accounts: SquadsAccountRow[]): Promise<void> {
    for (const account of accounts) {
      // A send and the proposal it rides on arrive as separate deliveries;
      // one read of the chain answers both.
      if (this.checking.has(account.userId)) continue;
      this.checking.add(account.userId);
      // One Account's unreadable settings must not stop the rest being
      // checked: this is the notice that has to arrive.
      try {
        await this.check(account);
      } catch (err) {
        this.logger.warn(
          `account_change.check_failed userId=${account.userId}`,
          err,
        );
      } finally {
        this.checking.delete(account.userId);
      }
    }
  }

  private async check(account: SquadsAccountRow): Promise<void> {
    // Every waiting change, not only the newest: one nobody here staged can
    // sit behind a change the Consumer made afterwards.
    for (const staged of await this.changes.pendingFor(account)) {
      // A change the backend staged was announced as it was staged, and
      // recording it again is a no-op. Any other is one nobody here staged,
      // and the notice for that says so rather than guessing.
      const written = await this.events.recordSettingsChangeStaged(
        account.userId,
        {
          changeIndex: staged.transactionIndex,
          change: staged.kind ?? undefined,
        },
      );
      if (written) {
        this.logger.warn(
          `account_change.found_unannounced userId=${account.userId} index=${staged.transactionIndex}`,
        );
      }
    }
  }
}
