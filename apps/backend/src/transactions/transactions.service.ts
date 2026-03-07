import { Injectable, NotFoundException } from '@nestjs/common';
import { GridService } from '../grid/grid.service';
import { DbService } from '../db/db.service';
import { transactions, smartAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';

interface SendDto {
    toAddress: string;
    amount:    string;
    token:     string;        // "SOL", "USDC" or mint address
    sessionSecrets: unknown;  // TaggedKeyPair[] from Grid, passed back by mobile
    session:   unknown;       // AuthenticationData from Grid
}

@Injectable()
export class TransactionsService {
    constructor(
        private grid: GridService,
        private db: DbService,
    ) {}

    async send(userId: string, dto: SendDto) {
        const [account] = await this.db.client
            .select()
            .from(smartAccounts)
            .where(eq(smartAccounts.userId, userId))
            .limit(1);

        if (!account) throw new NotFoundException('Wallet not found');

        const { gridAccountId } = account;

        // Prepare the transfer as an arbitrary transaction
        const prepared = await this.grid.client.prepareArbitraryTransaction(
            gridAccountId,
            { transaction: dto.toAddress }, // Grid handles building the transfer tx
        );

        // Sign and send via Grid
        const result = await this.grid.client.signAndSend({
            sessionSecrets:     dto.sessionSecrets as any,
            session:            dto.session as any,
            transactionPayload: prepared.data,
            address:            gridAccountId,
        });

        // Record in our DB
        const [tx] = await this.db.client
            .insert(transactions)
            .values({
                smartAccountId: account.id,
                signature:      result.data.transactionSignature,
                type:           'SEND',
                amount:         dto.amount,
                token:          dto.token,
                fromAddress:    gridAccountId,
                toAddress:      dto.toAddress,
                status:         'CONFIRMED',
                confirmedAt:    new Date(result.data.confirmedAt),
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

        return {
            transactions: dbTxs,
            transfers:    gridTransfers.data,
        };
    }
}