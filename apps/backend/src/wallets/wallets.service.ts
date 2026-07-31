import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { smartAccounts, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type {
  BalancesResponse,
  DeleteAccountResponse,
  WalletResponse,
} from './dtos';

/**
 * A Consumer tried to delete their account while a token balance remains.
 * The controller maps this to 409 ACCOUNT_HAS_BALANCE so the mobile app can
 * point the Consumer at withdrawing/sending their Balance first.
 */
export class AccountHasBalanceError extends Error {
  readonly code = 'ACCOUNT_HAS_BALANCE';
  constructor(message: string) {
    super(message);
    this.name = 'AccountHasBalanceError';
  }
}

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

  /**
   * Closes a Consumer's Xend account. Blocked while any token balance
   * remains — Xend has no custody path to sweep it out first, so a
   * Consumer must withdraw/send everything down to zero themselves.
   *
   * `users` is soft-deleted (`deletedAt` set, email anonymized to free it
   * up) rather than removed — `smart_accounts` and `transfers` stay in
   * place for the financial-recordkeeping retention the privacy policy
   * commits to. JwtStrategy rejects any token for a soft-deleted user, so
   * this is a hard lockout regardless of how long the caller's JWT still
   * has left to live.
   */
  async deleteMe(userId: string): Promise<DeleteAccountResponse> {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    const tokens = await this.solana.getTokenBalances(account.walletAddress);
    if (tokens.some((t) => t.amountRaw > 0n)) {
      throw new AccountHasBalanceError(
        'Balance must be zero before the account can be deleted',
      );
    }

    await this.db.client
      .update(users)
      .set({
        email: `deleted-${userId}@deleted.xend.internal`,
        deletedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { deleted: true };
  }
}
