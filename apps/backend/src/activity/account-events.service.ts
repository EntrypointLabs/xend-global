import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AccountEventKind } from '../db/schema';
import {
  SecurityNoticeService,
  type StagedChangeKind,
} from '../notifications/security-notice.service';
import {
  ACCOUNT_EVENT_STORE,
  type AccountEventRow,
  type AccountEventStore,
} from './account-event.store';

export type { AccountEventKind };

export interface AccountEvent {
  id: string;
  kind: AccountEventKind;
  /** The email, wallet address or name the event is about. */
  subject: string | null;
  /** What it replaced, on a rename. */
  previousSubject: string | null;
  /** The transaction that landed it, when there was one. */
  signature: string | null;
  occurredAt: Date;
}

/**
 * The kinds the Activity feed renders.
 *
 * The rest are recorded for the notice they trigger and for the audit trail,
 * and stay out of the feed until the app has a sentence for them: the client
 * parses the page strictly, so an unknown kind there fails the whole page.
 */
export const ACTIVITY_FEED_KINDS = [
  'recovery_key_added',
  'recovery_key_removed',
  'wallet_renamed',
  'device_rotated',
] as const satisfies readonly AccountEventKind[];

export type ActivityFeedKind = (typeof ACTIVITY_FEED_KINDS)[number];

export interface ActivityFeedEvent extends AccountEvent {
  kind: ActivityFeedKind;
}

/**
 * Records what happened to an Account, for the Activity feed and for the
 * notice the Consumer gets about it.
 *
 * Activity is the Consumer's record of their account, and money is only part of
 * it. A recovery key appearing or disappearing is a bigger deal than most
 * transfers, and the only place it would otherwise show is a settings screen
 * they have no reason to open.
 *
 * Every method is safe to call twice. The callers are reconcilers that run
 * again on every poll until the chain agrees, so "record this" has to mean
 * "make sure this is recorded" rather than "append a row".
 *
 * The write is also what sends the security notice, and only the write that
 * lands does: recording is the one thing every path that changes an Account
 * already does, so hanging the notice off it means no path can change the
 * Account and forget to say so, and no poll can say so twice.
 */
@Injectable()
export class AccountEventsService {
  private readonly logger = new Logger(AccountEventsService.name);

  constructor(
    @Inject(ACCOUNT_EVENT_STORE) private readonly store: AccountEventStore,
    private readonly notices: SecurityNoticeService,
  ) {}

  /**
   * A recovery key that has reached the on-chain signer set.
   *
   * Keyed on the signer rather than the settings change, because the same key
   * removed and added back later is a second thing that happened and deserves
   * its own line.
   */
  recordRecoveryKeyAdded(
    userId: string,
    params: {
      signerId: string;
      subject: string;
      signature?: string | null;
      occurredAt?: Date;
    },
  ): Promise<AccountEvent | null> {
    return this.record({
      userId,
      kind: 'recovery_key_added',
      subject: params.subject,
      signature: params.signature,
      dedupeKey: `recovery_key_added:${params.signerId}`,
      occurredAt: params.occurredAt,
    });
  }

  recordRecoveryKeyRemoved(
    userId: string,
    params: {
      signerId: string;
      subject: string;
      signature?: string | null;
      occurredAt?: Date;
    },
  ): Promise<AccountEvent | null> {
    return this.record({
      userId,
      kind: 'recovery_key_removed',
      subject: params.subject,
      signature: params.signature,
      dedupeKey: `recovery_key_removed:${params.signerId}`,
      occurredAt: params.occurredAt,
    });
  }

  /**
   * A recovery key re-keyed in place: same slot, new address or new anchor.
   *
   * Keyed on the settings change that carried it, since the signer row keeps
   * its id across the rotation and the same row can rotate more than once.
   */
  recordRecoveryKeyRotated(
    userId: string,
    params: {
      changeIndex: bigint | string;
      subject: string;
      previous?: string | null;
      signature?: string | null;
      occurredAt?: Date;
    },
  ): Promise<AccountEvent | null> {
    return this.record({
      userId,
      kind: 'recovery_key_rotated',
      subject: params.subject,
      previousSubject: params.previous,
      signature: params.signature,
      dedupeKey: `recovery_key_rotated:${userId}:${params.changeIndex}`,
      occurredAt: params.occurredAt,
    });
  }

  /**
   * The Account moved onto a new phone.
   *
   * Deduped on the incoming signer, so the reconciler that settles the change
   * can run as often as it likes and the Consumer still sees it once.
   */
  recordDeviceRotated(
    userId: string,
    newApprovalSigner: string,
    params: { previous?: string | null; signature?: string | null } = {},
  ): Promise<AccountEvent | null> {
    return this.record({
      userId,
      kind: 'device_rotated',
      subject: newApprovalSigner,
      previousSubject: params.previous,
      signature: params.signature,
      dedupeKey: `device_rotated:${newApprovalSigner}`,
    });
  }

  /**
   * The contact address moved, on execution of the change that moved it.
   *
   * `previousEmail` is kept on the row because the notice for this one goes
   * to both inboxes, and the old one is where the alarm has to land.
   */
  recordContactEmailChanged(
    userId: string,
    params: {
      changeIndex: bigint | string;
      previousEmail: string | null;
      nextEmail: string;
      signature?: string | null;
      occurredAt?: Date;
    },
  ): Promise<AccountEvent | null> {
    return this.record({
      userId,
      kind: 'contact_email_changed',
      subject: params.nextEmail,
      previousSubject: params.previousEmail,
      signature: params.signature,
      dedupeKey: `contact_email_changed:${userId}:${params.changeIndex}`,
      occurredAt: params.occurredAt,
    });
  }

  /**
   * A settings change staged against the Account, whoever staged it.
   *
   * Keyed on the change, so the service that staged it and the watcher that
   * later sees it on chain record the same fact and only the first one
   * notifies. `change` says what the change is when the recorder knows;
   * the watcher does not, and the notice for that case says so.
   */
  recordSettingsChangeStaged(
    userId: string,
    params: {
      changeIndex: bigint | string;
      subject?: string | null;
      change?: StagedChangeKind;
      occurredAt?: Date;
    },
  ): Promise<AccountEvent | null> {
    return this.record(
      {
        userId,
        kind: 'settings_change_staged',
        subject: params.subject,
        dedupeKey: `settings_change_staged:${userId}:${params.changeIndex}`,
        occurredAt: params.occurredAt,
      },
      { change: params.change },
    );
  }

  recordSettingsChangeExecuted(
    userId: string,
    params: {
      changeIndex: bigint | string;
      subject?: string | null;
      signature?: string | null;
      occurredAt?: Date;
    },
  ): Promise<AccountEvent | null> {
    return this.record({
      userId,
      kind: 'settings_change_executed',
      subject: params.subject,
      signature: params.signature,
      dedupeKey: `settings_change_executed:${userId}:${params.changeIndex}`,
      occurredAt: params.occurredAt,
    });
  }

  recordSettingsChangeRejected(
    userId: string,
    params: {
      changeIndex: bigint | string;
      subject?: string | null;
      signature?: string | null;
      occurredAt?: Date;
    },
  ): Promise<AccountEvent | null> {
    return this.record({
      userId,
      kind: 'settings_change_rejected',
      subject: params.subject,
      signature: params.signature,
      dedupeKey: `settings_change_rejected:${userId}:${params.changeIndex}`,
      occurredAt: params.occurredAt,
    });
  }

  /** A passkey that can now open the Account, keyed on the credential. */
  recordPasskeyEnrolled(
    userId: string,
    params: { credentialId: string; occurredAt?: Date },
  ): Promise<AccountEvent | null> {
    return this.record({
      userId,
      kind: 'passkey_enrolled',
      dedupeKey: `passkey_enrolled:${params.credentialId}`,
      occurredAt: params.occurredAt,
    });
  }

  /**
   * The Spending Limit was set to something else.
   *
   * `limit` is already in the Consumer's terms ("50 USDC a day"), because it
   * is shown to them verbatim.
   */
  recordSpendingLimitChanged(
    userId: string,
    params: {
      changeIndex: bigint | string;
      limit: string;
      previous?: string | null;
      signature?: string | null;
      occurredAt?: Date;
    },
  ): Promise<AccountEvent | null> {
    return this.record({
      userId,
      kind: 'spending_limit_changed',
      subject: params.limit,
      previousSubject: params.previous,
      signature: params.signature,
      dedupeKey: `spending_limit_changed:${userId}:${params.changeIndex}`,
      occurredAt: params.occurredAt,
    });
  }

  /**
   * A wallet given a new name.
   *
   * Deduped on the pair rather than on the name alone: renaming back to an
   * earlier name is a real change and should show as one.
   */
  recordWalletRenamed(
    userId: string,
    params: { name: string; previous: string | null; occurredAt?: Date },
  ): Promise<AccountEvent | null> {
    return this.record({
      userId,
      kind: 'wallet_renamed',
      subject: params.name,
      previousSubject: params.previous,
      dedupeKey: `wallet_renamed:${userId}:${params.previous ?? ''}:${params.name}`,
      occurredAt: params.occurredAt,
    });
  }

  async list(
    userId: string,
    params: { limit: number; before?: Date; after?: Date },
  ): Promise<ActivityFeedEvent[]> {
    const rows = await this.store.listByUser(userId, {
      ...params,
      kinds: ACTIVITY_FEED_KINDS,
    });
    return rows.map(toEvent).filter(isFeedEvent);
  }

  private async record(
    params: {
      userId: string;
      kind: AccountEventKind;
      subject?: string | null;
      previousSubject?: string | null;
      signature?: string | null;
      dedupeKey: string;
      occurredAt?: Date;
    },
    context: { change?: StagedChangeKind } = {},
  ): Promise<AccountEvent | null> {
    const written = await this.store.record({
      userId: params.userId,
      kind: params.kind,
      subject: params.subject ?? null,
      previousSubject: params.previousSubject ?? null,
      signature: params.signature ?? null,
      dedupeKey: params.dedupeKey,
      occurredAt: params.occurredAt ?? new Date(),
    });

    // Only the call that actually wrote it says so, and only that call
    // notifies. A reconciler re-recording the same fact is the normal case,
    // not an event.
    if (!written) return null;

    this.logger.log(
      `account_event.recorded userId=${params.userId} kind=${params.kind}`,
    );
    await this.notices.deliver(written, context);
    return toEvent(written);
  }
}

function isFeedEvent(event: AccountEvent): event is ActivityFeedEvent {
  return (ACTIVITY_FEED_KINDS as readonly AccountEventKind[]).includes(
    event.kind,
  );
}

function toEvent(row: AccountEventRow): AccountEvent {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    previousSubject: row.previousSubject,
    signature: row.signature,
    occurredAt: row.occurredAt,
  };
}
