import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { smartAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { BalancesResponse, WalletResponse } from './dtos';

/**
 * Backs `/wallet/me` and `/wallet/me/balances` via SolanaRpc
 * (FailoverSolanaRpc).
 */
@Injectable()
export class WalletsService {
  constructor(
    private db: DbService,
    @Inject(SOLANA_RPC) private solana: SolanaRpc,
  ) {}

  async getMe(userId: string): Promise<WalletResponse> {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    return {
      walletAddress: account.walletAddress,
      provider: 'privy',
    };
  }

  async getMeBalances(userId: string): Promise<BalancesResponse> {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    // Parallel read: tokens + a recent block reference. `lastValidBlockHeight`
    // is the closest monotonic chain marker without a separate getSlot round
    // trip; mobile uses it for cache-staleness signalling only.
    const [tokens, blockhash] = await Promise.all([
      this.solana.getTokenBalances(account.walletAddress),
      this.solana.getRecentBlockhash(),
    ]);

    return {
      walletAddress: account.walletAddress,
      tokens: tokens.map((t) => ({
        mint: t.mint,
        amountRaw: t.amountRaw.toString(),
        decimals: t.decimals,
        symbol: null,
      })),
      fetchedAtSlot: blockhash.lastValidBlockHeight,
    };
  }
}
