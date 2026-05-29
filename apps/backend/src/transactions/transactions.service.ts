import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { GridService } from '../grid/grid.service';
import { DbService } from '../db/db.service';
import { transactions, smartAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import { type SendTransactionDto } from './types';
import { toBaseUnits } from './tokens';

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

    const { gridAccountId } = account;

    // Convert the mobile-provided decimal string to Grid's base-unit string.
    const baseUnits = toBaseUnits(dto.amount, dto.token);

    // Build a Grid payment intent. The wrapped GridClient returns a typed
    // CreatePaymentIntentResponse whose data carries an optional transactionPayload.
    const prepared = await this.grid.client.createPaymentIntent(gridAccountId, {
      amount: baseUnits,
      source: { address: gridAccountId, currency: dto.token.toLowerCase() },
      destination: {
        address: dto.toAddress,
        currency: dto.token.toLowerCase(),
      },
    });

    if (!prepared.data.transactionPayload) {
      throw new InternalServerErrorException(
        `Grid createPaymentIntent returned no transactionPayload: ${
          prepared.data.error ?? 'unknown error'
        }`,
      );
    }

    // Sign and submit via Grid.
    const result = await this.grid.client.signAndSend({
      sessionSecrets: dto.sessionSecrets,
      session: dto.session,
      transactionPayload: prepared.data.transactionPayload,
      address: gridAccountId,
    });

    // Persist as PENDING; getHistory reconciles to CONFIRMED once Grid's
    // getTransfers reports finalization. This survives any future Grid SDK
    // change where signAndSend returns on submit (not finalization).
    const [tx] = await this.db.client
      .insert(transactions)
      .values({
        smartAccountId: account.id,
        signature: result.data.transactionSignature,
        type: 'SEND',
        amount: dto.amount,
        token: dto.token,
        fromAddress: gridAccountId,
        toAddress: dto.toAddress,
        status: 'PENDING',
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

    // Return our DB records + Grid transfers merged
    const [dbTxs, gridTransfers] = await Promise.all([
      this.db.client
        .select()
        .from(transactions)
        .where(eq(transactions.smartAccountId, account.id))
        .orderBy(transactions.createdAt),
      this.grid.getTransfers(account.gridAccountId),
    ]);

    // Reconcile any PENDING DB row that Grid has since confirmed.
    // Grid's transfer list is the source of truth for finalization; we flip the
    // DB status (and stamp confirmedAt) so subsequent reads see CONFIRMED.
    // BridgeTransfer entries don't carry a `signature` so the type narrowing
    // filters them out before building the lookup.
    const splTransfers = gridTransfers.data.filter(
      (t): t is Extract<typeof t, { signature: string }> => 'signature' in t,
    );
    const transfersBySig = new Map(splTransfers.map((t) => [t.signature, t]));

    const pendingToConfirm = dbTxs.filter(
      (r) =>
        r.status === 'PENDING' &&
        !!r.signature &&
        transfersBySig.has(r.signature),
    );

    if (pendingToConfirm.length > 0) {
      await Promise.all(
        pendingToConfirm.map((r) => {
          const t = transfersBySig.get(r.signature!)!;
          const confirmedAt =
            'confirmedAt' in t && t.confirmedAt ? new Date(t.confirmedAt) : null;
          return this.db.client
            .update(transactions)
            .set({ status: 'CONFIRMED', confirmedAt })
            .where(eq(transactions.id, r.id));
        }),
      );
      const freshTxs = await this.db.client
        .select()
        .from(transactions)
        .where(eq(transactions.smartAccountId, account.id))
        .orderBy(transactions.createdAt);
      return { transactions: freshTxs, transfers: gridTransfers.data };
    }

    return { transactions: dbTxs, transfers: gridTransfers.data };
  }
}
