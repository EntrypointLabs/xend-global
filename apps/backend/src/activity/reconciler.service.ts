import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { smartAccounts, tailerState } from '../db/schema';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type {
  SignatureStatus,
  SolanaRpc,
} from '../solana/solana-rpc.interface';
import { TailerService } from './tailer.service';

const RECONCILE_BATCH = 256;
/** Outstanding-PENDING age threshold before the cron tick will touch a row. */
const PENDING_AGE_MS = 30_000;

/**
 * ReconcilerService — the safety net for the webhook hot path.
 *
 * Two duties:
 *   1. **Boot replay** (onModuleInit): for each wallet in
 *      `smart_accounts`, stream confirmed transfers since
 *      `tailer_state.last_indexed_slot` via
 *      `solanaRpc.streamConfirmedTransfers` and write them via
 *      TailerService. Catches up anything missed while the process
 *      was down.
 *   2. **30-second poll** (@Cron): for every `transfers` row with
 *      `status='PENDING' AND submitted_at < NOW() - INTERVAL '30s'`,
 *      ask the cluster what happened via `getSignatureStatuses` and
 *      finalize the row to CONFIRMED or FAILED. Status guard is
 *      enforced via the WHERE clause: `WHERE signature=$1 AND
 *      status='PENDING'` — a row that has already been CONFIRMED or
 *      FAILED by the webhook path is untouched.
 *
 * Metrics (structured log lines — verifier-2 greppable):
 *   - `tailer.reconcile.batch outstanding=N finalized=M failed=K duration_ms=...`
 *   - `tailer.reconcile.percent_of_confirmations rolling=...` (computed
 *     over the in-process counters; resets on restart).
 *
 * Re-entrancy: the cron's WHERE clauses + status guards make double-
 * execution safe (the second tick finds nothing PENDING-and-old enough
 * because the first tick finalized them).
 */
@Injectable()
export class ReconcilerService implements OnModuleInit {
  private readonly logger = new Logger(ReconcilerService.name);

  // Rolling counters for the "percent of confirmations via
  // reconciliation vs webhook" metric. Reset on process restart;
  // computed lazily on each tick. The webhook hot path does not need
  // to update these — anything the reconciler finalizes is, by
  // definition, missed-by-webhook.
  private reconcileFinalizedCount = 0;
  private webhookFinalizedCount = 0;

  constructor(
    private readonly db: DbService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    private readonly tailer: TailerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.replayAllWallets();
  }

  /**
   * Replay any confirmed transfers that landed while the service was
   * down. Bounded by `tailer_state.last_indexed_slot` per wallet.
   *
   * Catches exceptions per-wallet so a single broken wallet does not
   * block the rest of the boot sequence.
   */
  async replayAllWallets(): Promise<void> {
    const wallets = await this.db.client
      .select({
        id: smartAccounts.id,
        walletAddress: smartAccounts.walletAddress,
      })
      .from(smartAccounts);

    if (wallets.length === 0) {
      this.logger.log('tailer.reconcile.boot wallets=0 (nothing to replay)');
      return;
    }

    let totalReplayed = 0;
    for (const w of wallets) {
      try {
        const replayed = await this.replayWallet(w.id, w.walletAddress);
        totalReplayed += replayed;
      } catch (err) {
        this.logger.error(
          `Boot replay failed for ${w.walletAddress}; reconciliation poll will catch up`,
          err,
        );
      }
    }
    this.logger.log(
      `tailer.reconcile.boot wallets=${wallets.length} replayed=${totalReplayed}`,
    );
  }

  /**
   * Replay a single wallet. Returns the count of events written.
   *
   * Uses `streamConfirmedTransfers(wallet, sinceSlot)`. The Failover
   * adapter falls back to the public RPC if Helius is down at prime
   * time.
   */
  async replayWallet(
    smartAccountId: string,
    walletAddress: string,
  ): Promise<number> {
    const [bookmark] = await this.db.client
      .select()
      .from(tailerState)
      .where(eq(tailerState.walletAddress, walletAddress))
      .limit(1);
    const sinceSlot = bookmark?.lastIndexedSlot ?? 0n;

    let count = 0;
    for await (const evt of this.solana.streamConfirmedTransfers(
      walletAddress,
      sinceSlot,
    )) {
      await this.tailer.upsertConfirmedTransfer(
        evt,
        smartAccountId,
        walletAddress,
      );
      count++;
    }
    return count;
  }

  /**
   * 30-second tick. Reconciles outstanding PENDING transfers.
   */
  @Cron('*/30 * * * * *')
  async tick(): Promise<void> {
    const t0 = Date.now();

    // Compute the cutoff server-side using LOCALTIMESTAMP, which
    // returns `timestamp without time zone` in the server's local
    // time. The `transfers.submitted_at` column is also `timestamp
    // without time zone` (Phase 1 schema choice), so both sides of
    // the comparison live in the same naive-time space. Passing a JS
    // Date here would round-trip through timestamptz and silently
    // shift by the server's UTC offset under non-UTC timezones (we
    // hit exactly this on a TZ=Africa/Lagos dev DB during Task 2.3
    // devnet verification).
    const outstanding = (await this.db.client.execute(sql`
      SELECT signature, smart_account_id AS "smartAccountId"
      FROM transfers
      WHERE status = 'PENDING'
        AND submitted_at < LOCALTIMESTAMP - INTERVAL '${sql.raw(`${PENDING_AGE_MS / 1000}`)} seconds'
      ORDER BY submitted_at ASC
      LIMIT ${sql.raw(`${RECONCILE_BATCH}`)}
    `)) as unknown as {
      rows: { signature: string; smartAccountId: string }[];
    };
    const rows = outstanding.rows ?? [];

    if (rows.length === 0) {
      this.logger.debug(
        `tailer.reconcile.batch outstanding=0 finalized=0 failed=0 duration_ms=${Date.now() - t0}`,
      );
      return;
    }

    const signatures = rows
      .map((r) => r.signature)
      .filter((s): s is string => !!s);

    let statuses: SignatureStatus[];
    try {
      statuses = await this.solana.getSignatureStatuses(signatures);
    } catch (err) {
      this.logger.error(
        `tailer.reconcile.batch outstanding=${rows.length} getSignatureStatuses failed`,
        err,
      );
      return;
    }

    let finalized = 0;
    let failed = 0;
    for (const status of statuses) {
      if (status.err) {
        // Cluster reports an error — finalize as FAILED.
        await this.db.client.execute(sql`
          UPDATE transfers
          SET status = 'FAILED'::transfer_status,
              failure_reason = ${JSON.stringify(status.err)},
              confirmed_at = NOW()
          WHERE signature = ${status.signature}
            AND status = 'PENDING'
        `);
        failed++;
        this.reconcileFinalizedCount++;
      } else if (
        status.confirmationStatus === 'confirmed' ||
        status.confirmationStatus === 'finalized'
      ) {
        const slotStr = status.slot != null ? status.slot.toString() : null;
        if (slotStr) {
          await this.db.client.execute(sql`
            UPDATE transfers
            SET status = 'CONFIRMED'::transfer_status,
                confirmed_at = NOW(),
                slot = ${slotStr}::bigint
            WHERE signature = ${status.signature}
              AND status = 'PENDING'
          `);
        } else {
          await this.db.client.execute(sql`
            UPDATE transfers
            SET status = 'CONFIRMED'::transfer_status,
                confirmed_at = NOW()
            WHERE signature = ${status.signature}
              AND status = 'PENDING'
          `);
        }
        finalized++;
        this.reconcileFinalizedCount++;
      }
      // else: still in flight — leave PENDING; the next tick checks again.
    }

    const duration = Date.now() - t0;
    this.logger.log(
      `tailer.reconcile.batch outstanding=${rows.length} finalized=${finalized} failed=${failed} duration_ms=${duration}`,
    );

    // Rolling percent metric. Denominator includes both paths; on a
    // healthy webhook this trends to <5%, alert-worthy at >20%.
    const totalConfirmed =
      this.reconcileFinalizedCount + this.webhookFinalizedCount;
    if (totalConfirmed > 0) {
      const pct = Math.round(
        (this.reconcileFinalizedCount / totalConfirmed) * 100,
      );
      this.logger.log(
        `tailer.reconcile.percent_of_confirmations rolling=${pct}% (reconciled=${this.reconcileFinalizedCount} webhook=${this.webhookFinalizedCount})`,
      );
    }
  }

  /** Called by the webhook hot path so the percent metric has a denom. */
  recordWebhookFinalization(): void {
    this.webhookFinalizedCount++;
  }
}
