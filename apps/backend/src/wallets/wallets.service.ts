import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { GridService } from '../grid/grid.service';
import { DbService } from '../db/db.service';
import { smartAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { BalancesResponse, WalletResponse } from './dtos';

@Injectable()
export class WalletsService {
  constructor(
    private grid: GridService,
    private db: DbService,
    @Inject(SOLANA_RPC) private solana: SolanaRpc,
  ) {}

  // ── Legacy (Grid-backed) ──────────────────────────────────────────
  //
  // Surface the existing Grid-shaped payload to the pre-Phase-4 mobile
  // build. These methods stay until Phase 5.

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

  // ── Phase 1 (Privy + SolanaRpc-backed) ───────────────────────────
  //
  // Replacements for the legacy pair above. Mounted at /wallet/me and
  // /wallet/me/balances. Mobile cuts over in Phase 4.

  async getMe(userId: string): Promise<WalletResponse> {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    return {
      walletAddress: account.walletAddress,
      // Spec §5.3: `provider: z.literal('privy')`. The DB row carries
      // the same enum value; we re-emit it as the literal type so a
      // future enum extension (Turnkey) doesn't silently widen the
      // public API.
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

    // Parallel read: tokens + a recent block reference so we can stamp
    // the response with a chain height. We use `lastValidBlockHeight`
    // from getRecentBlockhash as a monotonic chain marker; it is not
    // the actual processed slot but is close enough for the spec
    // contract `fetchedAtSlot: z.number().int()` and avoids a separate
    // `getSlot` round-trip. The mobile uses it only for cache-staleness
    // signalling.
    //
    // We do NOT filter to stablecoins server-side per the task brief:
    // mobile filters for the headline Balance per spec §5.5. The full
    // token list is needed for the Investments tab.
    const [tokens, blockhash] = await Promise.all([
      this.solana.getTokenBalances(account.walletAddress),
      this.solana.getRecentBlockhash(),
    ]);

    return {
      walletAddress: account.walletAddress,
      tokens: tokens.map((t) => ({
        mint: t.mint,
        // amountRaw is BigInt at the adapter boundary; serialize to
        // string per the spec (z.string() with the integer interpretation).
        amountRaw: t.amountRaw.toString(),
        decimals: t.decimals,
        // Spec §5.5 marks `symbol` nullable. The backend does not
        // resolve mint metadata (that's mobile's job); we always
        // return null here.
        symbol: null,
      })),
      fetchedAtSlot: blockhash.lastValidBlockHeight,
    };
  }
}
