import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, asc, desc, gt, gte, lte, sql } from 'drizzle-orm';
import {
  Connection,
  PublicKey,
  type VersionedTransactionResponse,
} from '@solana/web3.js';
import {
  associatedTokenAddress,
  earnAsset,
  earnAssetByMint,
  type EarnProviderId,
} from '@prydd/smart-account';
import { DbService } from '../db/db.service';
import { earnOperations, earnPositionSnapshots } from '../db/schema';
import {
  TOKEN_PRICE_PROVIDER,
  type TokenPriceProvider,
} from '../prices/token-price.interface';
import { usdValueOf } from '../prices/usd-value';
import { ServerAnalytics } from '../analytics/server-analytics.service';
import { bucketAmount } from '../analytics/redact';
import {
  positionKey,
  providerEarnings,
  weekAgoDay,
  type EarnBaseline,
  type EarnPositionKey,
  type EarnSnapshot,
  type ProviderEarnings,
} from './earn-history';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
export const EARN_RECORDS = Symbol('EarnRecords');
export interface EarnPending {
  userId: string;
  signature: string;
  vault: string;
  provider: EarnProviderId;
  mint: string;
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
  /** Each position's income, in that position's asset base units. */
  earnings(
    userId: string,
    positions: (EarnPositionKey & { shares: bigint; value: bigint })[],
  ): Promise<(EarnPositionKey & ProviderEarnings)[]>;
  /** `positionKey`s that already have a snapshot. */
  positionsWithHistory(userId: string): Promise<Set<string>>;
  recordSnapshots(
    userId: string,
    day: string,
    snapshots: EarnSnapshot[],
  ): Promise<void>;
  snapshots(
    userId: string,
    key: EarnPositionKey,
    fromDay: string | null,
  ): Promise<{ day: string; valueMinor: string; netDepositedMinor: string }[]>;
  usersWithEarn(): Promise<string[]>;
}
/**
 * The vault's change in the lent asset and in its receipt shares.
 *
 * Native SOL is wrapped and unwrapped inside the same transaction, so for SOL
 * the vault's holding is its own lamports plus every lamport in its
 * wrapped-SOL account, rent included. Closing that account moves its rent to
 * the vault, and counting both sides keeps that rent out of the deposit.
 */
export function earnDeltas(
  tx: VersionedTransactionResponse,
  vault: string,
  receipt: string,
  mint: string,
): { cash: bigint; shares: bigint } | null {
  if (!tx.meta || tx.meta.err) return null;
  const sum = (rows: typeof tx.meta.preTokenBalances, m: string) =>
    (rows ?? [])
      .filter((r) => r.owner === vault && r.mint === m)
      .reduce((n, row) => n + BigInt(row.uiTokenAmount.amount), 0n);
  let cash: bigint;
  if (mint === WRAPPED_SOL) {
    const keys = tx.transaction.message
      .getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses })
      .keySegments()
      .flat()
      .map((k) => k.toBase58());
    const index = keys.indexOf(vault);
    if (index < 0) return null;
    const wrapped = keys.indexOf(
      associatedTokenAddress(
        new PublicKey(vault),
        new PublicKey(WRAPPED_SOL),
        earnAsset('jupiter', 'SOL').tokenProgram,
      ).toBase58(),
    );
    const lamports = (i: number) =>
      i < 0 ? 0n : BigInt(tx.meta!.postBalances[i] - tx.meta!.preBalances[i]);
    cash = lamports(index) + lamports(wrapped);
  } else {
    cash =
      sum(tx.meta.postTokenBalances, mint) -
      sum(tx.meta.preTokenBalances, mint);
  }
  return {
    cash,
    shares:
      sum(tx.meta.postTokenBalances, receipt) -
      sum(tx.meta.preTokenBalances, receipt),
  };
}
@Injectable()
export class DrizzleEarnRecords implements EarnRecords {
  constructor(
    private readonly db: DbService,
    @Optional()
    @Inject(TOKEN_PRICE_PROVIDER)
    private readonly prices?: TokenPriceProvider,
    @Optional() private readonly analytics?: ServerAnalytics,
  ) {}
  private report(
    event:
      | 'server_earn_submitted'
      | 'server_earn_confirmed'
      | 'server_earn_failed',
    row: Pick<EarnPending, 'userId' | 'provider' | 'mint' | 'action'>,
    usdValue?: string | null,
  ) {
    this.analytics?.capture(
      event,
      { consumerId: row.userId },
      {
        kind: row.action === 'redeem' ? 'withdraw' : 'deposit',
        provider: row.provider,
        token: this.analytics.tokenSymbol(row.mint),
        amount_bucket:
          usdValue == null ? undefined : bucketAmount(Number(usdValue)),
        ...(event === 'server_earn_failed' ? { reason: 'chain_error' } : {}),
      },
    );
  }
  /** Frozen at confirmation, like a transfer's value, so Activity never reprices it. */
  private async usdValue(mint: string, amount: bigint): Promise<string | null> {
    const asset = earnAssetByMint(mint);
    if (!this.prices || !asset) return null;
    try {
      return await usdValueOf(
        this.prices,
        mint,
        amount < 0n ? -amount : amount,
        earnAsset('jupiter', asset).decimals,
      );
    } catch {
      return null;
    }
  }
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
    // A retried submit re-records the same signature; only the first counts.
    const inserted = await this.db.client
      .insert(earnOperations)
      .values(record)
      .onConflictDoNothing()
      .returning({ signature: earnOperations.signature });
    if (inserted.length) this.report('server_earn_submitted', record);
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
              const failed = await this.db.client
                .update(earnOperations)
                .set({ status: 'failed', wire: null })
                .where(
                  and(
                    eq(earnOperations.signature, row.signature),
                    eq(earnOperations.status, 'pending'),
                  ),
                )
                .returning({ signature: earnOperations.signature });
              if (failed.length) this.report('server_earn_failed', row);
              return;
            }
            const asset = earnAssetByMint(row.mint);
            if (!asset) return;
            const delta = earnDeltas(
              tx,
              row.vault,
              earnAsset(row.provider, asset).receipt.toBase58(),
              row.mint,
            );
            if (!delta || !tx.blockTime) return;
            if (
              (row.action === 'deposit' &&
                (delta.cash >= 0n || delta.shares <= 0n)) ||
              (row.action === 'redeem' &&
                (delta.cash <= 0n || delta.shares >= 0n))
            )
              return;
            const usdValue = await this.usdValue(row.mint, delta.cash);
            const confirmed = await this.db.client
              .update(earnOperations)
              .set({
                status: 'confirmed',
                wire: null,
                cashDeltaRaw: delta.cash.toString(),
                shareDeltaRaw: delta.shares.toString(),
                usdValue,
                confirmedAt: new Date(tx.blockTime * 1000),
              })
              .where(
                and(
                  eq(earnOperations.signature, row.signature),
                  eq(earnOperations.status, 'pending'),
                ),
              )
              .returning({ signature: earnOperations.signature });
            if (confirmed.length)
              this.report('server_earn_confirmed', row, usdValue);
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
    positions: (EarnPositionKey & { shares: bigint; value: bigint })[],
  ) {
    const now = Date.now();
    const [rows, baselines] = await Promise.all([
      this.db.client
        .select()
        .from(earnOperations)
        .where(eq(earnOperations.userId, userId)),
      this.baselines(userId, weekAgoDay(now)),
    ]);
    return positions.map((p) => ({
      provider: p.provider,
      mint: p.mint,
      ...providerEarnings(
        rows,
        p,
        p,
        now,
        baselines.get(positionKey(p)) ?? { weekAgo: null, earliest: null },
      ),
    }));
  }
  private async baselines(
    userId: string,
    weekAgo: string,
  ): Promise<Map<string, EarnBaseline>> {
    const columns = {
      provider: earnPositionSnapshots.provider,
      mint: earnPositionSnapshots.mint,
      day: earnPositionSnapshots.day,
      valueMinor: earnPositionSnapshots.valueMinor,
      netDepositedMinor: earnPositionSnapshots.netDepositedMinor,
    };
    const distinct = [
      earnPositionSnapshots.provider,
      earnPositionSnapshots.mint,
    ];
    const [weekAgoRows, earliestRows] = await Promise.all([
      this.db.client
        .selectDistinctOn(distinct, columns)
        .from(earnPositionSnapshots)
        .where(
          and(
            eq(earnPositionSnapshots.userId, userId),
            lte(earnPositionSnapshots.day, weekAgo),
          ),
        )
        .orderBy(...distinct, desc(earnPositionSnapshots.day)),
      this.db.client
        .selectDistinctOn(distinct, columns)
        .from(earnPositionSnapshots)
        .where(eq(earnPositionSnapshots.userId, userId))
        .orderBy(...distinct, asc(earnPositionSnapshots.day)),
    ]);
    const row = (r: (typeof weekAgoRows)[number]) => ({
      day: r.day,
      valueMinor: r.valueMinor,
      netDepositedMinor: r.netDepositedMinor,
    });
    const out = new Map<string, EarnBaseline>();
    for (const r of earliestRows)
      out.set(positionKey(r), { weekAgo: null, earliest: row(r) });
    for (const r of weekAgoRows) {
      const key = positionKey(r);
      out.set(key, {
        earliest: out.get(key)?.earliest ?? null,
        weekAgo: row(r),
      });
    }
    return out;
  }
  async positionsWithHistory(userId: string) {
    const rows = await this.db.client
      .selectDistinct({
        provider: earnPositionSnapshots.provider,
        mint: earnPositionSnapshots.mint,
      })
      .from(earnPositionSnapshots)
      .where(eq(earnPositionSnapshots.userId, userId));
    return new Set(rows.map(positionKey));
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
          earnPositionSnapshots.mint,
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
    key: EarnPositionKey,
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
          eq(earnPositionSnapshots.provider, key.provider),
          eq(earnPositionSnapshots.mint, key.mint),
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
