import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ACCOUNT_EVENT_STORE,
  type AccountEventRow,
  type AccountEventStore,
} from './account-event.store';

export type AccountEventKind =
  | 'recovery_key_added'
  | 'recovery_key_removed'
  | 'wallet_renamed'
  | 'device_rotated';

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
 * Records what happened to an Account, for the Activity feed.
 *
 * Activity is the Consumer's record of their account, and money is only part of
 * it. A recovery key appearing or disappearing is a bigger deal than most
 * transfers, and the only place it would otherwise show is a settings screen
 * they have no reason to open.
 *
 * Every method is safe to call twice. The callers are reconcilers that run
 * again on every poll until the chain agrees, so "record this" has to mean
 * "make sure this is recorded" rather than "append a row".
 */
@Injectable()
export class AccountEventsService {
  private readonly logger = new Logger(AccountEventsService.name);

  constructor(
    @Inject(ACCOUNT_EVENT_STORE) private readonly store: AccountEventStore,
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
  ): Promise<AccountEvent[]> {
    const rows = await this.store.listByUser(userId, params);
    return rows.map(toEvent);
  }

  private async record(params: {
    userId: string;
    kind: AccountEventKind;
    subject: string;
    previousSubject?: string | null;
    signature?: string | null;
    dedupeKey: string;
    occurredAt?: Date;
  }): Promise<AccountEvent | null> {
    const written = await this.store.record({
      userId: params.userId,
      kind: params.kind,
      subject: params.subject,
      previousSubject: params.previousSubject ?? null,
      signature: params.signature ?? null,
      dedupeKey: params.dedupeKey,
      occurredAt: params.occurredAt ?? new Date(),
    });

    // Only the call that actually wrote it says so. A reconciler re-recording
    // the same fact is the normal case, not an event.
    if (written) {
      this.logger.log(
        `account_event.recorded userId=${params.userId} kind=${params.kind}`,
      );
    }
    return written ? toEvent(written) : null;
  }
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
