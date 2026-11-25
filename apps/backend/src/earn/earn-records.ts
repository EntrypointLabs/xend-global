import { Injectable } from '@nestjs/common';
import { and, eq, asc, gt } from 'drizzle-orm';
import { Connection, type VersionedTransactionResponse } from '@solana/web3.js';
import {
  EARN_PROVIDERS,
  type EarnProviderId,
  EARN_USDC,
} from '@prydd/smart-account';
import { DbService } from '../db/db.service';
import { earnOperations } from '../db/schema';
export const EARN_RECORDS = Symbol('EarnRecords');
export interface EarnPending {
  userId: string;
  signature: string;
  vault: string;
  provider: EarnProviderId;
  action: 'deposit' | 'redeem';
  wire: string;
  messageHash: string;
  quote: Record<string, string | number>;
  blockHeight: number;
}
export interface EarnRecords {
  recover(
    userId: string,
    messageHash: string,
  ): Promise<{
    wire: string | null;
    signature: string;
    status?: string;
    quote: Record<string, string | number>;
    blockHeight: number;
  } | null>;
  pending(record: EarnPending): Promise<void>;
  reconcile(userId: string, rpc: Connection): Promise<void>;
  earnings(
    userId: string,
    positions: Record<EarnProviderId, { shares: bigint; value: bigint }>,
  ): Promise<{
    lifetimeMinor: string | null;
    lastSevenDaysMinor: string | null;
  }>;
}
export function earnDeltas(
  tx: VersionedTransactionResponse,
  vault: string,
  receipt: string,
): { cash: bigint; shares: bigint } | null {
  if (!tx.meta || tx.meta.err) return null;
  const sum = (rows: typeof tx.meta.preTokenBalances, mint: string) =>
    (rows ?? [])
      .filter((r) => r.owner === vault && r.mint === mint)
      .reduce((n, row) => n + BigInt(row.uiTokenAmount.amount), 0n);
  return {
    cash:
      sum(tx.meta.postTokenBalances, EARN_USDC.toBase58()) -
      sum(tx.meta.preTokenBalances, EARN_USDC.toBase58()),
    shares:
      sum(tx.meta.postTokenBalances, receipt) -
      sum(tx.meta.preTokenBalances, receipt),
  };
}
@Injectable()
export class DrizzleEarnRecords implements EarnRecords {
  constructor(private readonly db: DbService) {}
  async recover(userId: string, messageHash: string) {
    const [row] = await this.db.client
      .select()
      .from(earnOperations)
      .where(
        and(
          eq(earnOperations.userId, userId),
          eq(earnOperations.messageHash, messageHash),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  async pending(record: EarnPending) {
    await this.db.client
      .insert(earnOperations)
      .values(record)
      .onConflictDoNothing();
  }
  async reconcile(userId: string, rpc: Connection) {
    // Keyset pages keep unresolved newer broadcasts from hiding older ones.
    let cursor: string | undefined;
    while (true) {
      const pending = await this.db.client
        .select()
        .from(earnOperations)
        .where(
          and(
            eq(earnOperations.userId, userId),
            eq(earnOperations.status, 'pending'),
            cursor ? gt(earnOperations.signature, cursor) : undefined,
          ),
        )
        .orderBy(asc(earnOperations.signature))
        .limit(100);
      if (!pending.length) break;
      for (let offset = 0; offset < pending.length; offset += 8) {
        await Promise.all(
          pending.slice(offset, offset + 8).map(async (row) => {
            const tx = await rpc.getTransaction(row.signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            });
            if (!tx?.meta) return;
            if (tx.meta.err) {
              await this.db.client
                .update(earnOperations)
                .set({ status: 'failed', wire: null })
                .where(eq(earnOperations.signature, row.signature));
              return;
            }
            const delta = earnDeltas(
              tx,
              row.vault,
              EARN_PROVIDERS[row.provider].receipt,
            );
            if (!delta || !tx.blockTime) return;
            if (
              (row.action === 'deposit' &&
                (delta.cash >= 0n || delta.shares <= 0n)) ||
              (row.action === 'redeem' &&
                (delta.cash <= 0n || delta.shares >= 0n))
            )
              return;
            await this.db.client
              .update(earnOperations)
              .set({
                status: 'confirmed',
                wire: null,
                cashDeltaRaw: delta.cash.toString(),
                shareDeltaRaw: delta.shares.toString(),
                confirmedAt: new Date(tx.blockTime * 1000),
              })
              .where(eq(earnOperations.signature, row.signature));
          }),
        );
      }
      const last = pending[pending.length - 1];
      cursor = last.signature;
      if (pending.length < 100) break;
    }
  }
  async earnings(
    userId: string,
    positions: Record<EarnProviderId, { shares: bigint; value: bigint }>,
  ) {
    const rows = await this.db.client
      .select()
      .from(earnOperations)
      .where(eq(earnOperations.userId, userId));
    let lifetime = 0n;
    let recentOnly = true;
    for (const provider of ['kamino', 'jupiter'] as const) {
      const confirmed = rows.filter(
        (r) => r.provider === provider && r.status === 'confirmed',
      );
      const recorded = confirmed.reduce(
        (n, r) => n + BigInt(r.shareDeltaRaw ?? '0'),
        0n,
      );
      if (recorded !== positions[provider].shares)
        return { lifetimeMinor: null, lastSevenDaysMinor: null };
      lifetime +=
        positions[provider].value +
        confirmed.reduce((n, r) => n + BigInt(r.cashDeltaRaw ?? '0'), 0n);
      if (
        confirmed.some(
          (r) =>
            !r.confirmedAt ||
            r.confirmedAt.getTime() < Date.now() - 7 * 86400000,
        )
      )
        recentOnly = false;
    }
    // Once the position predates this window, a historic price/snapshot is
    // necessary. Do not present lifetime income as seven-day income.
    return {
      lifetimeMinor: lifetime.toString(),
      lastSevenDaysMinor: recentOnly ? lifetime.toString() : null,
    };
  }
}
