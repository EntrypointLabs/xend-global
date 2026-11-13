import { Injectable } from '@nestjs/common';
import { and, count, eq, gt } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { feedback, type AppPlatform } from '../db/schema';

export const FEEDBACK_STORE = Symbol('FEEDBACK_STORE');

export interface NewFeedback {
  userId: string;
  message: string;
  rating: number | null;
  appVersion: string | null;
  platform: AppPlatform | null;
  createdAt: Date;
}

/**
 * Persistence seam for feedback, so the daily limit can be tested without a
 * database.
 */
export interface FeedbackStore {
  /**
   * Runs `fn` with this Consumer's other feedback held back until it is done.
   *
   * The limit is a count followed by a write. Two messages counted side by
   * side would each see room for itself.
   */
  oneAtATime<T>(userId: string, fn: () => Promise<T>): Promise<T>;

  /** How many messages this Consumer sent after `since`, exclusive. */
  countSince(userId: string, since: Date): Promise<number>;

  /** Returns the new row's id. */
  insert(row: NewFeedback): Promise<string>;
}

@Injectable()
export class DrizzleFeedbackStore implements FeedbackStore {
  constructor(private readonly db: DbService) {}

  oneAtATime<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return this.db.withAdvisoryLock(`feedback:${userId}`, fn);
  }

  async countSince(userId: string, since: Date): Promise<number> {
    const [row] = await this.db.client
      .select({ messages: count() })
      .from(feedback)
      .where(and(eq(feedback.userId, userId), gt(feedback.createdAt, since)));
    return row.messages;
  }

  async insert(row: NewFeedback): Promise<string> {
    const [inserted] = await this.db.client
      .insert(feedback)
      .values(row)
      .returning({ id: feedback.id });
    return inserted.id;
  }
}
