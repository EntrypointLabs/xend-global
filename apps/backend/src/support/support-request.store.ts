import { Injectable } from '@nestjs/common';
import { and, count, eq, gt } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import {
  smartAccounts,
  squadsAccounts,
  supportRequests,
  users,
  type AppPlatform,
  type SupportTopic,
} from '../db/schema';

export const SUPPORT_REQUEST_STORE = Symbol('SUPPORT_REQUEST_STORE');

export interface NewSupportRequest {
  userId: string;
  topic: SupportTopic;
  message: string;
  contactEmail: string | null;
  appVersion: string | null;
  platform: AppPlatform | null;
  createdAt: Date;
}

/** Who a request is from, as the team needs it to find and answer them. */
export interface SupportRequester {
  email: string | null;
  /** Where their money is: the vault once there is one, the wallet before. */
  accountAddress: string | null;
}

export type CloseOutcome = 'closed' | 'already_closed' | 'not_found';

/**
 * Persistence seam for support requests, so the limit and the mail that
 * follows a request can be tested without a database.
 */
export interface SupportRequestStore {
  findRequester(userId: string): Promise<SupportRequester>;

  /**
   * Runs `fn` with this Consumer's other requests held back until it is done.
   *
   * The limit is a count followed by a write. Two requests counted side by
   * side would each see room for itself.
   */
  oneAtATime<T>(userId: string, fn: () => Promise<T>): Promise<T>;

  /** How many requests this Consumer made after `since`, exclusive. */
  countSince(userId: string, since: Date): Promise<number>;

  /** Returns the new request's id. */
  insert(request: NewSupportRequest): Promise<string>;

  /** Closes an open request, and says so only when this call closed it. */
  close(id: string, at: Date): Promise<CloseOutcome>;
}

@Injectable()
export class DrizzleSupportRequestStore implements SupportRequestStore {
  constructor(private readonly db: DbService) {}

  async findRequester(userId: string): Promise<SupportRequester> {
    const [row] = await this.db.client
      .select({
        email: users.email,
        vaultAddress: squadsAccounts.vaultAddress,
        walletAddress: smartAccounts.walletAddress,
      })
      .from(users)
      .leftJoin(squadsAccounts, eq(squadsAccounts.userId, users.id))
      .leftJoin(smartAccounts, eq(smartAccounts.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    return {
      email: row?.email ?? null,
      accountAddress: row?.vaultAddress ?? row?.walletAddress ?? null,
    };
  }

  oneAtATime<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return this.db.withAdvisoryLock(`support-requests:${userId}`, fn);
  }

  async countSince(userId: string, since: Date): Promise<number> {
    const [row] = await this.db.client
      .select({ requests: count() })
      .from(supportRequests)
      .where(
        and(
          eq(supportRequests.userId, userId),
          gt(supportRequests.createdAt, since),
        ),
      );
    return row.requests;
  }

  async insert(request: NewSupportRequest): Promise<string> {
    const [row] = await this.db.client
      .insert(supportRequests)
      .values(request)
      .returning({ id: supportRequests.id });
    return row.id;
  }

  async close(id: string, at: Date): Promise<CloseOutcome> {
    const [closed] = await this.db.client
      .update(supportRequests)
      .set({ status: 'closed', closedAt: at })
      .where(
        and(eq(supportRequests.id, id), eq(supportRequests.status, 'open')),
      )
      .returning({ id: supportRequests.id });
    if (closed) return 'closed';

    const [existing] = await this.db.client
      .select({ id: supportRequests.id })
      .from(supportRequests)
      .where(eq(supportRequests.id, id))
      .limit(1);
    return existing ? 'already_closed' : 'not_found';
  }
}
