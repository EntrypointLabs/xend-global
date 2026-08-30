import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { entrySessions, smartAccounts, users } from '../db/schema';

export const ENTRY_SESSION_STORE = Symbol('ENTRY_SESSION_STORE');

export type EntrySessionRow = typeof entrySessions.$inferSelect;

/** A session that still validates, with the account it belongs to. */
export interface LiveEntrySession {
  session: EntrySessionRow;
  userId: string;
  walletAddress: string;
}

/**
 * Persistence seam for entry sessions.
 *
 * `findLive` encodes every rule that decides whether a presented token is
 * good: unexpired, unrevoked, on an account that is bound and not closed. A
 * caller never has to remember those, which is what keeps the guard small.
 */
export interface EntrySessionStore {
  insert(row: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<EntrySessionRow>;
  findLive(tokenHash: string, now: Date): Promise<LiveEntrySession | null>;
  revoke(id: string, now: Date): Promise<void>;
}

@Injectable()
export class DrizzleEntrySessionStore implements EntrySessionStore {
  constructor(private readonly db: DbService) {}

  async insert(row: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<EntrySessionRow> {
    const [inserted] = await this.db.client
      .insert(entrySessions)
      .values(row)
      .returning();
    return inserted;
  }

  async findLive(
    tokenHash: string,
    now: Date,
  ): Promise<LiveEntrySession | null> {
    const [row] = await this.db.client
      .select({
        session: entrySessions,
        walletAddress: smartAccounts.walletAddress,
      })
      .from(entrySessions)
      .innerJoin(users, eq(users.id, entrySessions.userId))
      .innerJoin(smartAccounts, eq(smartAccounts.userId, users.id))
      .where(
        and(
          eq(entrySessions.tokenHash, tokenHash),
          isNull(entrySessions.revokedAt),
          gt(entrySessions.expiresAt, now),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      session: row.session,
      userId: row.session.userId,
      walletAddress: row.walletAddress,
    };
  }

  async revoke(id: string, now: Date): Promise<void> {
    await this.db.client
      .update(entrySessions)
      .set({ revokedAt: now })
      .where(and(eq(entrySessions.id, id), isNull(entrySessions.revokedAt)));
  }
}
