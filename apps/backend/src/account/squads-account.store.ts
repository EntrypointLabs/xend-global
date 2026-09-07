import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DbService } from '../db/db.service';
import { squadsAccounts, users } from '../db/schema';
import type { SquadsAccountRow, SquadsAccountStore } from './account.interface';

@Injectable()
export class DrizzleSquadsAccountStore implements SquadsAccountStore {
  constructor(private readonly db: DbService) {}

  async findByUserId(userId: string): Promise<SquadsAccountRow | null> {
    const [row] = await this.db.client
      .select()
      .from(squadsAccounts)
      .where(eq(squadsAccounts.userId, userId))
      .limit(1);

    return row ? toRow(row) : null;
  }

  async updateByUserId(
    userId: string,
    patch: Partial<Omit<SquadsAccountRow, 'userId'>>,
  ): Promise<SquadsAccountRow> {
    const [row] = await this.db.client
      .update(squadsAccounts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(squadsAccounts.userId, userId))
      .returning();
    return toRow(row);
  }

  async listAll(): Promise<SquadsAccountRow[]> {
    const rows = await this.db.client.select().from(squadsAccounts);
    return rows.map(toRow);
  }

  async findUserEmail(userId: string): Promise<string | null> {
    const [row] = await this.db.client
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return row?.email ?? null;
  }

  async insert(row: SquadsAccountRow): Promise<SquadsAccountRow> {
    const [inserted] = await this.db.client
      .insert(squadsAccounts)
      .values(row)
      .returning();

    return toRow(inserted);
  }

  withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return this.db.withAdvisoryLock(`account:enrolment:${userId}`, fn);
  }
}

function toRow(row: typeof squadsAccounts.$inferSelect): SquadsAccountRow {
  return {
    userId: row.userId,
    settingsSeed: row.settingsSeed,
    settingsAddress: row.settingsAddress,
    vaultAddress: row.vaultAddress,
    primarySigner: row.primarySigner,
    approvalSigner: row.approvalSigner,
    approvalSubOrgId: row.approvalSubOrgId,
    pendingApprovalSigner: row.pendingApprovalSigner,
    pendingApprovalSubOrgId: row.pendingApprovalSubOrgId,
    pendingApprovalChangeIndex: row.pendingApprovalChangeIndex,
    pendingPrimarySigner: row.pendingPrimarySigner,
    pendingPrimaryProviderId: row.pendingPrimaryProviderId,
    pendingPrimaryChangeIndex: row.pendingPrimaryChangeIndex,
    spendingLimitPolicySeed: row.spendingLimitPolicySeed,
  };
}
