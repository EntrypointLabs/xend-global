import { Injectable } from '@nestjs/common';
import { and, eq, asc, desc, gt, gte, lte, sql } from 'drizzle-orm';
import { Connection, type VersionedTransactionResponse } from '@solana/web3.js';
import {
  EARN_PROVIDERS,
  type EarnProviderId,
  EARN_USDC,
} from '@prydd/smart-account';
import { DbService } from '../db/db.service';
import { earnOperations, earnPositionSnapshots } from '../db/schema';
import {
  providerEarnings,
  totalEarnings,
  weekAgoDay,
  type EarnBaseline,
  type EarnSnapshot,
  type ProviderEarnings,
} from './earn-history';
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
    providers: Record<EarnProviderId, ProviderEarnings>;
  }>;
  providersWithHistory(userId: string): Promise<Set<EarnProviderId>>;
  recordSnapshots(
    userId: string,
    day: string,
    snapshots: EarnSnapshot[],
  ): Promise<void>;
  snapshots(
    userId: string,
    provider: EarnProviderId,
    fromDay: string | null,
  ): Promise<{ day: string; valueMinor: string; netDepositedMinor: string }[]>;
  usersWithEarn(): Promise<string[]>;
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
    const now = Date.now();
    const [rows, baselines] = await Promise.all([
      this.db.client
        .select()
        .from(earnOperations)
        .where(eq(earnOperations.userId, userId)),
      this.baselines(userId, weekAgoDay(now)),
    ]);
    const providers = {
      kamino: providerEarnings(
        rows,
        'kamino',
        positions.kamino,
        now,
        baselines.kamino,
      ),
      jupiter: providerEarnings(
        rows,
        'jupiter',
        positions.jupiter,
        now,
        baselines.jupiter,
      ),
    };
    return { ...totalEarnings(providers), providers };
  }
  private async baselines(
    userId: string,
    weekAgo: string,
  ): Promise<Record<EarnProviderId, EarnBaseline>> {
    const columns = {
      provider: earnPositionSnapshots.provider,
      day: earnPositionSnapshots.day,
      valueMinor: earnPositionSnapshots.valueMinor,
      netDepositedMinor: earnPositionSnapshots.netDepositedMinor,
    };
    const [weekAgoRows, earliestRows] = await Promise.all([
      this.db.client
        .selectDistinctOn([earnPositionSnapshots.provider], columns)
        .from(earnPositionSnapshots)
        .where(
          and(
            eq(earnPositionSnapshots.userId, userId),
            lte(earnPositionSnapshots.day, weekAgo),
          ),
        )
        .orderBy(
          earnPositionSnapshots.provider,
          desc(earnPositionSnapshots.day),
        ),
      this.db.client
        .selectDistinctOn([earnPositionSnapshots.provider], columns)
        .from(earnPositionSnapshots)
        .where(eq(earnPositionSnapshots.userId, userId))
        .orderBy(
          earnPositionSnapshots.provider,
          asc(earnPositionSnapshots.day),
        ),
    ]);
    const pick = (
      rows: typeof weekAgoRows,
      provider: EarnProviderId,
    ): EarnBaseline['earliest'] => {
      const row = rows.find((r) => r.provider === provider);
      return row
        ? {
            day: row.day,
            valueMinor: row.valueMinor,
            netDepositedMinor: row.netDepositedMinor,
          }
        : null;
    };
    return {
      kamino: {
        weekAgo: pick(weekAgoRows, 'kamino'),
        earliest: pick(earliestRows, 'kamino'),
      },
      jupiter: {
        weekAgo: pick(weekAgoRows, 'jupiter'),
        earliest: pick(earliestRows, 'jupiter'),
      },
    };
  }
  async providersWithHistory(userId: string) {
    const rows = await this.db.client
      .selectDistinct({ provider: earnPositionSnapshots.provider })
      .from(earnPositionSnapshots)
      .where(eq(earnPositionSnapshots.userId, userId));
    return new Set(rows.map((r) => r.provider));
  }
  async recordSnapshots(
    userId: string,
    day: string,
    snapshots: EarnSnapshot[],
  ) {
    if (!snapshots.length) return;
    await this.db.client
      .insert(earnPositionSnapshots)
      .values(snapshots.map((s) => ({ ...s, userId, day })))
      .onConflictDoUpdate({
        target: [
          earnPositionSnapshots.userId,
          earnPositionSnapshots.provider,
          earnPositionSnapshots.day,
        ],
        set: {
          valueMinor: sql`excluded.value_minor`,
          netDepositedMinor: sql`excluded.net_deposited_minor`,
          updatedAt: sql`now()`,
        },
      });
  }
  async snapshots(
    userId: string,
    provider: EarnProviderId,
    fromDay: string | null,
  ) {
    return this.db.client
      .select({
        day: earnPositionSnapshots.day,
        valueMinor: earnPositionSnapshots.valueMinor,
        netDepositedMinor: earnPositionSnapshots.netDepositedMinor,
      })
      .from(earnPositionSnapshots)
      .where(
        and(
          eq(earnPositionSnapshots.userId, userId),
          eq(earnPositionSnapshots.provider, provider),
          fromDay ? gte(earnPositionSnapshots.day, fromDay) : undefined,
        ),
      )
      .orderBy(asc(earnPositionSnapshots.day));
  }
  async usersWithEarn() {
    const rows = await this.db.client
      .selectDistinct({ userId: earnOperations.userId })
      .from(earnOperations)
      .where(eq(earnOperations.status, 'confirmed'));
    return rows.map((r) => r.userId);
  }
}
