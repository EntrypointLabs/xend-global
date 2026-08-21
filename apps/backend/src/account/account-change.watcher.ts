import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
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
 */
@Injectable()
export class AccountChangeWatcher {
  private readonly logger = new Logger(AccountChangeWatcher.name);

  constructor(
    private readonly db: DbService,
    private readonly changes: AccountChangeService,
    private readonly notifications: NotificationsService,
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

    if (!(await this.claimAnnouncement(account, staged.transactionIndex))) {
      return;
    }

    // A change the Consumer started themselves still gets a notice, because a
    // stolen phone can start one the same way, but not the alarm: crying wolf
    // over a deliberate action is what teaches people to swipe the real one
    // away.
    await this.notifications.notifySecurityAlert(
      account.userId,
      staged.selfInitiated
        ? {
            title: 'Your recovery key change is on its way',
            body: staged.executableAt
              ? 'It goes through once the security delay ends. Open Xend to cancel it.'
              : 'It needs one more approval. Open Xend to cancel it.',
          }
        : {
            title: 'Check your Xend account',
            body: staged.executableAt
              ? 'A change to your account is waiting to go through. If it was not you, open Xend and reject it.'
              : 'Someone started a change to your account. If it was not you, open Xend and reject it.',
          },
    );
  }

  /**
   * Records the announcement, and says whether this call is the one that made
   * it. Written before the notice goes out, so a failure to send costs one
   * notice rather than repeating it every five minutes forever.
   */
  private async claimAnnouncement(
    account: SquadsAccountRow,
    transactionIndex: string,
  ): Promise<boolean> {
    const result = (await this.db.client.execute(sql`
      INSERT INTO announced_account_changes
        (id, user_id, settings_address, transaction_index, announced_at)
      VALUES (
        ${createId()},
        ${account.userId},
        ${account.settingsAddress},
        ${transactionIndex}::bigint,
        NOW()
      )
      ON CONFLICT (settings_address, transaction_index) DO NOTHING
      RETURNING id
    `)) as unknown as { rows: { id: string }[] };
    return (result.rows?.length ?? 0) > 0;
  }
}

function createId(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createId: mint } = require('@paralleldrive/cuid2') as {
    createId: () => string;
  };
  return mint();
}
