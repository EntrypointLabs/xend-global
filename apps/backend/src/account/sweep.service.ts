import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DbService } from '../db/db.service';
import { smartAccounts } from '../db/schema';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { SQUADS_ACCOUNT_STORE } from './account.interface';
import type { SquadsAccountStore } from './account.interface';

export interface SweepPlan {
  /** False when there is nothing left in the Privy wallet. */
  needed: boolean;
  /** Where it goes. Absent when no Account exists yet. */
  destination?: string;
  balances: { mint: string; amountRaw: string; decimals: number }[];
}

/**
 * Moves what is left in the Privy embedded wallet into the Squads vault.
 *
 * Small but not empty: the dApp Store reviewer left roughly 0.75 USDC on a
 * mainnet Privy wallet, and internal testers hold their own. The whole reason
 * the multisig ships before the store listing is to keep this set small enough
 * that nobody has to be told their saved address changed.
 *
 * This only plans. The transfer itself is signed by Privy on the device, so the
 * backend cannot move these funds and deliberately has no way to.
 */
@Injectable()
export class SweepService {
  private readonly logger = new Logger(SweepService.name);

  constructor(
    private readonly db: DbService,
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
  ) {}

  async plan(userId: string): Promise<SweepPlan> {
    const account = await this.store.findByUserId(userId);
    if (!account) return { needed: false, balances: [] };

    const [privy] = await this.db.client
      .select({ walletAddress: smartAccounts.walletAddress })
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!privy) return { needed: false, balances: [] };

    const tokens = await this.solana.getTokenBalances(privy.walletAddress);
    const balances = tokens
      .filter((token) => token.amountRaw > 0n)
      .map((token) => ({
        mint: token.mint,
        amountRaw: token.amountRaw.toString(),
        decimals: token.decimals,
      }));

    if (balances.length > 0) {
      this.logger.log(
        `sweep.pending userId=${userId} mints=${balances.length}`,
      );
    }

    return {
      needed: balances.length > 0,
      destination: account.vaultAddress,
      balances,
    };
  }
}
