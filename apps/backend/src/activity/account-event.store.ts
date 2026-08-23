import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, lt } from 'drizzle-orm';

import { DbService } from '../db/db.service';
import { accountEvents } from '../db/schema';

export const ACCOUNT_EVENT_STORE = Symbol('ACCOUNT_EVENT_STORE');

export type AccountEventRow = typeof accountEvents.$inferSelect;
export type NewAccountEvent = typeof accountEvents.$inferInsert;

/**
 * Persistence seam for account events.
 *
 * Same split as the recovery signers: the rules live in the service and the
 * storage lives here, so the rules can be tested without a database.
 */
export interface AccountEventStore {
  /**
   * Writes the event, or does nothing if its `dedupeKey` is already recorded.
   *
   * Returns the row only when this call is the one that wrote it, so a caller
   * can tell "recorded" from "already known" without reading first.
   */
  record(row: NewAccountEvent): Promise<AccountEventRow | null>;
  /**
   * Newest first, within a window.
   *
   * `before` and `after` are both exclusive `occurredAt` bounds. The feed pages
   * on transfers, so events are asked for over exactly the span a page of
   * transfers covers; without the lower bound an event older than the page
   * would jump ahead of transfers that belong before it.
   */
  listByUser(
    userId: string,
    params: { limit: number; before?: Date; after?: Date },
  ): Promise<AccountEventRow[]>;
}

@Injectable()
export class DrizzleAccountEventStore implements AccountEventStore {
  constructor(private readonly db: DbService) {}

  async record(row: NewAccountEvent): Promise<AccountEventRow | null> {
    // The unique index on dedupe_key is the guard, not a prior read: the
    // recorder runs from a poll loop, so two ticks can race here.
    const [written] = await this.db.client
      .insert(accountEvents)
      .values(row)
      .onConflictDoNothing({ target: accountEvents.dedupeKey })
      .returning();
    return written ?? null;
  }

  listByUser(
    userId: string,
    { limit, before, after }: { limit: number; before?: Date; after?: Date },
  ): Promise<AccountEventRow[]> {
    const bounds = [eq(accountEvents.userId, userId)];
    if (before) bounds.push(lt(accountEvents.occurredAt, before));
    if (after) bounds.push(gt(accountEvents.occurredAt, after));

    return this.db.client
      .select()
      .from(accountEvents)
      .where(and(...bounds))
      .orderBy(desc(accountEvents.occurredAt))
      .limit(limit);
  }
}
