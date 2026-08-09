import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DbService } from '../db/db.service';
import { squadsAccounts } from '../db/schema';
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

  async insert(row: SquadsAccountRow): Promise<SquadsAccountRow> {
    const [inserted] = await this.db.client
      .insert(squadsAccounts)
      .values(row)
      .returning();

    return toRow(inserted);
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
  };
}
