import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { recoveryChallenges } from '../db/schema';

export const RECOVERY_CHALLENGE_STORE = Symbol('RECOVERY_CHALLENGE_STORE');

export type RecoveryChallengeRow = typeof recoveryChallenges.$inferSelect;
export type NewRecoveryChallenge = typeof recoveryChallenges.$inferInsert;
export type RecoveryChallengePurpose = RecoveryChallengeRow['purpose'];

/**
 * Persistence seam for email challenges, matching `RecoverySignerStore`.
 *
 * The rules worth testing here are all about time and counting: how many codes
 * an inbox can be sent, how many guesses a code survives, how long a proof
 * stays good. None of them need a database to be exercised.
 */
export interface RecoveryChallengeStore {
  insert(row: NewRecoveryChallenge): Promise<RecoveryChallengeRow>;
  /** The newest unconsumed, unexpired challenge for this purpose, or null. */
  findOpen(
    userId: string,
    purpose: RecoveryChallengePurpose,
    now: Date,
  ): Promise<RecoveryChallengeRow | null>;
  findById(id: string): Promise<RecoveryChallengeRow | null>;
  /** How many codes went to this Consumer since `since`. The send-rate guard. */
  countSince(userId: string, since: Date): Promise<number>;
  updateById(
    id: string,
    patch: Partial<NewRecoveryChallenge>,
  ): Promise<RecoveryChallengeRow>;
  /**
   * Takes one of the allowed guesses, or returns null when they are gone.
   *
   * A read-then-write cannot do this. Requests that arrive together all read
   * the same count and all write the same next value, so a batch of guesses
   * costs one attempt instead of one each, and the cap that makes six digits
   * safe stops being a cap. The increment and the bound are one statement here
   * so exactly one caller can win each attempt.
   */
  claimAttempt(
    id: string,
    maxAttempts: number,
  ): Promise<RecoveryChallengeRow | null>;
  /**
   * Expires every open challenge for this purpose.
   *
   * Issuing a new code has to invalidate the last one, or two live codes
   * double the guessing surface for the same attempt cap.
   */
  expireOpen(
    userId: string,
    purpose: RecoveryChallengePurpose,
    now: Date,
  ): Promise<void>;
}

@Injectable()
export class DrizzleRecoveryChallengeStore implements RecoveryChallengeStore {
  constructor(private readonly db: DbService) {}

  async insert(row: NewRecoveryChallenge): Promise<RecoveryChallengeRow> {
    const [inserted] = await this.db.client
      .insert(recoveryChallenges)
      .values(row)
      .returning();
    return inserted;
  }

  async findOpen(
    userId: string,
    purpose: RecoveryChallengePurpose,
    now: Date,
  ): Promise<RecoveryChallengeRow | null> {
    const [row] = await this.db.client
      .select()
      .from(recoveryChallenges)
      .where(
        and(
          eq(recoveryChallenges.userId, userId),
          eq(recoveryChallenges.purpose, purpose),
          isNull(recoveryChallenges.consumedAt),
          gt(recoveryChallenges.expiresAt, now),
        ),
      )
      .orderBy(desc(recoveryChallenges.createdAt))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<RecoveryChallengeRow | null> {
    const [row] = await this.db.client
      .select()
      .from(recoveryChallenges)
      .where(eq(recoveryChallenges.id, id))
      .limit(1);
    return row ?? null;
  }

  async countSince(userId: string, since: Date): Promise<number> {
    const rows = await this.db.client
      .select({ id: recoveryChallenges.id })
      .from(recoveryChallenges)
      .where(
        and(
          eq(recoveryChallenges.userId, userId),
          gt(recoveryChallenges.createdAt, since),
        ),
      );
    return rows.length;
  }

  async claimAttempt(
    id: string,
    maxAttempts: number,
  ): Promise<RecoveryChallengeRow | null> {
    const [row] = await this.db.client
      .update(recoveryChallenges)
      .set({ attempts: sql`${recoveryChallenges.attempts} + 1` })
      .where(
        and(
          eq(recoveryChallenges.id, id),
          lt(recoveryChallenges.attempts, maxAttempts),
        ),
      )
      .returning();
    return row ?? null;
  }

  async updateById(
    id: string,
    patch: Partial<NewRecoveryChallenge>,
  ): Promise<RecoveryChallengeRow> {
    const [row] = await this.db.client
      .update(recoveryChallenges)
      .set(patch)
      .where(eq(recoveryChallenges.id, id))
      .returning();
    return row;
  }

  async expireOpen(
    userId: string,
    purpose: RecoveryChallengePurpose,
    now: Date,
  ): Promise<void> {
    await this.db.client
      .update(recoveryChallenges)
      .set({ expiresAt: now })
      .where(
        and(
          eq(recoveryChallenges.userId, userId),
          eq(recoveryChallenges.purpose, purpose),
          isNull(recoveryChallenges.consumedAt),
          gt(recoveryChallenges.expiresAt, now),
        ),
      );
  }
}
