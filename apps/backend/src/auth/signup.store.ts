import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import {
  recoveryChallenges,
  recoverySigners,
  signupTokens,
  smartAccounts,
  users,
} from '../db/schema';

export const SIGNUP_STORE = Symbol('SIGNUP_STORE');

export type UsersRow = typeof users.$inferSelect;
export type SignupTokenRow = typeof signupTokens.$inferSelect;

/**
 * What an address is to the platform before a code goes out.
 *
 * `claimed` means a Consumer exists behind it: a Privy user has been bound,
 * and a code sent there opens an entry session rather than a sign-up.
 * `closed` is an account that was deleted and whose address is kept for the
 * records; nothing is sent there. `pending` is a users row created by an
 * earlier code request that nothing has claimed.
 */
export type AddressStanding =
  | { kind: 'free' }
  | { kind: 'claimed'; user: UsersRow; walletAddress: string }
  | { kind: 'closed' }
  | { kind: 'pending'; user: UsersRow };

/**
 * Persistence seam for the pre-passkey half of sign-up.
 *
 * A pending users row is one with no `smart_accounts` row: nothing has bound a
 * Privy user to it, so nothing can reach it except a sign-up token. Every
 * query here that returns a user encodes that rule, which keeps the service
 * from having to remember it at each call site.
 */
export interface SignupStore {
  standingOf(email: string): Promise<AddressStanding>;
  createPendingUser(): Promise<UsersRow>;
  /** Marks a pending row as still in use, so the reaper leaves it alone. */
  touchUser(userId: string): Promise<void>;
  /**
   * Writes the proved address. Rejects with a Postgres unique violation when
   * an Account claimed it in the meantime; the service translates that.
   */
  setEmail(userId: string, email: string): Promise<void>;
  insertToken(row: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<SignupTokenRow>;
  /** Every live token for this row stops validating. Run before a new one is minted. */
  expireTokens(userId: string, now: Date): Promise<void>;
  /**
   * Spends the token, or returns null when it cannot be spent.
   *
   * The check and the write are one statement so that two exchanges racing
   * on the same token cannot both read it as live.
   */
  claimToken(tokenHash: string, now: Date): Promise<SignupTokenRow | null>;
  /** The row a token may bind: a proved address, not closed, nothing bound yet. */
  findPendingUser(userId: string): Promise<UsersRow | null>;
  /**
   * Removes users rows nobody bound before `before`, with everything that
   * hangs off them. Returns how many went.
   */
  deleteAbandonedBefore(before: Date): Promise<number>;
}

@Injectable()
export class DrizzleSignupStore implements SignupStore {
  constructor(private readonly db: DbService) {}

  async standingOf(email: string): Promise<AddressStanding> {
    const [onRow] = await this.db.client
      .select({
        user: users,
        boundId: smartAccounts.id,
        walletAddress: smartAccounts.walletAddress,
      })
      .from(users)
      .leftJoin(smartAccounts, eq(smartAccounts.userId, users.id))
      .where(eq(users.email, email))
      .limit(1);

    if (onRow) {
      if (onRow.user.deletedAt) return { kind: 'closed' };
      if (onRow.boundId && onRow.walletAddress) {
        return {
          kind: 'claimed',
          user: onRow.user,
          walletAddress: onRow.walletAddress,
        };
      }
      return { kind: 'pending', user: onRow.user };
    }

    // An Account moving its contact address to this one holds it from the
    // moment the change is staged, not the day it executes: letting a
    // sign-up take it in between would leave that change unable to land, and
    // it is not a way in either until the change has executed. Answered the
    // way a closed address is: same shape, no mail.
    const [reserved] = await this.db.client
      .select({ boundId: smartAccounts.id })
      .from(recoverySigners)
      .innerJoin(users, eq(users.id, recoverySigners.userId))
      .leftJoin(smartAccounts, eq(smartAccounts.userId, users.id))
      .where(
        and(
          eq(recoverySigners.channel, 'email'),
          eq(recoverySigners.channelValue, email),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    if (reserved?.boundId) return { kind: 'closed' };

    // The address is not on any row yet. A code may still have gone out for
    // it: the row it was issued against carries no email until the code is
    // proved, so the challenge is the only thing that names it.
    const [viaChallenge] = await this.db.client
      .select({ user: users, boundId: smartAccounts.id })
      .from(recoveryChallenges)
      .innerJoin(users, eq(users.id, recoveryChallenges.userId))
      .leftJoin(smartAccounts, eq(smartAccounts.userId, users.id))
      .where(
        and(
          eq(recoveryChallenges.purpose, 'contact_verification'),
          eq(recoveryChallenges.target, email),
          isNull(users.deletedAt),
          isNull(users.email),
        ),
      )
      .orderBy(desc(recoveryChallenges.createdAt))
      .limit(1);

    if (viaChallenge && !viaChallenge.boundId) {
      return { kind: 'pending', user: viaChallenge.user };
    }
    return { kind: 'free' };
  }

  async createPendingUser(): Promise<UsersRow> {
    const [row] = await this.db.client
      .insert(users)
      .values({ email: null })
      .returning();
    return row;
  }

  async touchUser(userId: string): Promise<void> {
    await this.db.client
      .update(users)
      .set({ updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async setEmail(userId: string, email: string): Promise<void> {
    await this.db.client
      .update(users)
      .set({ email, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async insertToken(row: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<SignupTokenRow> {
    const [inserted] = await this.db.client
      .insert(signupTokens)
      .values(row)
      .returning();
    return inserted;
  }

  async expireTokens(userId: string, now: Date): Promise<void> {
    await this.db.client
      .update(signupTokens)
      .set({ expiresAt: now })
      .where(
        and(
          eq(signupTokens.userId, userId),
          isNull(signupTokens.consumedAt),
          gt(signupTokens.expiresAt, now),
        ),
      );
  }

  async claimToken(
    tokenHash: string,
    now: Date,
  ): Promise<SignupTokenRow | null> {
    const [row] = await this.db.client
      .update(signupTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(signupTokens.tokenHash, tokenHash),
          isNull(signupTokens.consumedAt),
          gt(signupTokens.expiresAt, now),
        ),
      )
      .returning();
    return row ?? null;
  }

  async findPendingUser(userId: string): Promise<UsersRow | null> {
    const [row] = await this.db.client
      .select({ user: users, boundId: smartAccounts.id })
      .from(users)
      .leftJoin(smartAccounts, eq(smartAccounts.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row || row.boundId || row.user.deletedAt || !row.user.email) {
      return null;
    }
    return row.user;
  }

  async deleteAbandonedBefore(before: Date): Promise<number> {
    const stale = await this.db.client
      .select({ id: users.id })
      .from(users)
      .leftJoin(smartAccounts, eq(smartAccounts.userId, users.id))
      .where(and(isNull(smartAccounts.id), lt(users.updatedAt, before)));
    const ids = stale.map((row) => row.id);
    if (ids.length === 0) return 0;

    // Children first: none of these foreign keys cascade, and a pending row
    // can own a challenge, a sealed recovery signer and a token.
    await this.db.client
      .delete(recoveryChallenges)
      .where(inArray(recoveryChallenges.userId, ids));
    await this.db.client
      .delete(recoverySigners)
      .where(inArray(recoverySigners.userId, ids));
    await this.db.client
      .delete(signupTokens)
      .where(inArray(signupTokens.userId, ids));
    await this.db.client.delete(users).where(inArray(users.id, ids));
    return ids.length;
  }
}
