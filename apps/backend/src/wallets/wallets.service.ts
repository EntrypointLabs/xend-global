import { Injectable, NotFoundException } from '@nestjs/common';
import { GridService } from '../grid/grid.service';
import { DbService } from '../db/db.service';
import { smartAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class WalletsService {
  constructor(
    private grid: GridService,
    private db: DbService,
  ) {}

  async getWallet(userId: string) {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    const gridAccount = await this.grid.getAccount(account.walletAddress);

    return {
      id: account.id,
      // Legacy field name kept for the mobile app pre-Phase-4 cutover.
      // New endpoints return `walletAddress` directly per spec §5.3.
      gridAccountId: account.walletAddress,
      walletAddress: account.walletAddress,
      ...gridAccount.data,
    };
  }

  async getBalances(userId: string) {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    const balances = await this.grid.getBalances(account.walletAddress);
    return balances.data;
  }
}
