import { Injectable, NotFoundException } from '@nestjs/common';
import { GridService } from '../grid/grid.service';
import { DbService } from '../db/db.service';
import { transfers, smartAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import { type SendTransactionDto } from './types';

/**
 * Legacy transactions service — kept alive during Phase 1 so the
 * mobile app's existing send path keeps working until the Phase 4
 * cutover replaces it with /transfers/prepare + /transfers/submit.
 *
 * Phase 1 reshape:
 *   - The Drizzle table is now `transfers` (renamed from `transactions`)
 *     with provider-neutral columns: direction / mint / amount_raw.
 *   - The legacy send path defaults `direction='SEND'` and maps
 *     `dto.token` -> mint, `dto.amount` -> amount_raw.
 *   - No `intent_id` is recorded here because the legacy path does not
 *     have a prepare step; the new /transfers/submit path (Task 4)
 *     enforces idempotency on intent_id.
 *
 * Phase 5 deletes this file along with the /transactions controller.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private grid: GridService,
    private db: DbService,
  ) {}

  async send(userId: string, dto: SendTransactionDto) {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    const { walletAddress } = account;

    // Prepare the transfer as an arbitrary transaction
    const prepared = await this.grid.client.prepareArbitraryTransaction(
      walletAddress,
      { transaction: dto.toAddress }, // Grid handles building the transfer tx
    );

    // Sign and send via Grid
    const result = await this.grid.client.signAndSend({
      sessionSecrets: dto.sessionSecrets,
      session: dto.session,
      transactionPayload: prepared.data,
      address: walletAddress,
    });

    // Record in our DB using the new transfers shape.
    const [tx] = await this.db.client
      .insert(transfers)
      .values({
        smartAccountId: account.id,
        signature: result.data.transactionSignature,
        direction: 'SEND',
        // dto.token is the SDK-era field (mint address or symbol).
        // Tasks 4 will tighten this to require a mint pubkey; for now
        // we pass it through unchanged for the legacy path.
        mint: dto.token,
        amountRaw: dto.amount,
        fromAddress: walletAddress,
        toAddress: dto.toAddress,
        status: 'CONFIRMED',
        confirmedAt: new Date(result.data.confirmedAt),
      })
      .returning();

    return tx;
  }

  async getHistory(userId: string) {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, userId))
      .limit(1);

    if (!account) throw new NotFoundException('Wallet not found');

    // Return our DB records + Grid transfers merged.
    const [dbTxs, gridTransfers] = await Promise.all([
      this.db.client
        .select()
        .from(transfers)
        .where(eq(transfers.smartAccountId, account.id))
        .orderBy(transfers.createdAt),
      this.grid.getTransfers(account.walletAddress),
    ]);

    return {
      transactions: dbTxs,
      transfers: gridTransfers.data,
    };
  }
}
