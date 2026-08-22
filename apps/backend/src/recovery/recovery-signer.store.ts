import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { recoverySigners } from '../db/schema';

export const RECOVERY_SIGNER_STORE = Symbol('RECOVERY_SIGNER_STORE');

export type RecoverySignerRow = typeof recoverySigners.$inferSelect;
export type NewRecoverySigner = typeof recoverySigners.$inferInsert;

/**
 * Persistence seam for recovery signers.
 *
 * RecoveryService owns the rules (at least one signer, no duplicate channels)
 * and this owns the storage, so the rules can be tested without standing up a
 * database or faking a query builder.
 */
export interface RecoverySignerStore {
  findByUser(userId: string): Promise<RecoverySignerRow[]>;
  /**
   * Across every Consumer, not just one.
   *
   * `address` is globally unique, so an address already used by somebody else
   * cannot be inserted. Reading it first turns a driver-level constraint
   * violation into an answer the Consumer can act on.
   */
  findByAddress(address: string): Promise<RecoverySignerRow | null>;
  insert(row: NewRecoverySigner): Promise<RecoverySignerRow>;
  deleteById(id: string): Promise<void>;
  updateById(
    id: string,
    patch: Partial<NewRecoverySigner>,
  ): Promise<RecoverySignerRow>;
}

@Injectable()
export class DrizzleRecoverySignerStore implements RecoverySignerStore {
  constructor(private readonly db: DbService) {}

  findByUser(userId: string): Promise<RecoverySignerRow[]> {
    return this.db.client
      .select()
      .from(recoverySigners)
      .where(eq(recoverySigners.userId, userId));
  }

  async findByAddress(address: string): Promise<RecoverySignerRow | null> {
    const [row] = await this.db.client
      .select()
      .from(recoverySigners)
      .where(eq(recoverySigners.address, address))
      .limit(1);
    return row ?? null;
  }

  async insert(row: NewRecoverySigner): Promise<RecoverySignerRow> {
    const [inserted] = await this.db.client
      .insert(recoverySigners)
      .values(row)
      .returning();
    return inserted;
  }

  async deleteById(id: string): Promise<void> {
    await this.db.client
      .delete(recoverySigners)
      .where(eq(recoverySigners.id, id));
  }

  async updateById(
    id: string,
    patch: Partial<NewRecoverySigner>,
  ): Promise<RecoverySignerRow> {
    const [updated] = await this.db.client
      .update(recoverySigners)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(recoverySigners.id, id))
      .returning();
    return updated;
  }
}
