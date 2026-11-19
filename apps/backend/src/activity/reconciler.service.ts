import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { smartAccounts, squadsAccounts, tailerState } from '../db/schema';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type {
  SignatureStatus,
  SolanaRpc,
} from '../solana/solana-rpc.interface';
import { TailerService } from './tailer.service';

const RECONCILE_BATCH = 256;
/** Outstanding-PENDING age threshold before the tick will touch a row. */
const PENDING_AGE_MS = 30_000;
/**
 * Max time a PENDING row whose signature the cluster still does not know
 * (null status, no err) may stay PENDING before being force-failed. A
 * Solana blockhash is valid for ~150 slots (~60-90s); once a signature
 * has not landed well past that window it was dropped from the mempool
 * or its blockhash expired and it will never land. Force-failing these
 * stops them from occupying the bounded, oldest-first reconcile batch
 * forever (starving newer PENDING rows).
 */
const PENDING_EXPIRY_MS = 120_000;

/** How long after the last check a still-PENDING send is looked at again. */
const PENDING_RECHECK_MS = 30_000;
/**
 * A send still PENDING this long after submission is anomalous: it has either
 * landed or been force-failed many checks ago. It stops counting as a reason
 * to keep checking, so one wedged row cannot keep an idle database awake
 * forever; the boot check still finalizes it.
 */
const PENDING_RECHECK_HORIZON_MS = 60 * 60 * 1000;
/**
 * At most one on-chain catch-up per Consumer in this window. Opening the app
 * fetches activity, and a Consumer who pulls to refresh should not pay for a
 * signature scan each time.
 */
const USER_CATCH_UP_INTERVAL_MS = 5 * 60 * 1000;
/**
 * How long the activity fetch waits for a catch-up before answering without
 * it. The catch-up carries on, and the next fetch shows what it found.
 */
const USER_CATCH_UP_WAIT_MS = 3_000;

/**
 * The safety net for the webhook hot path. Nothing here runs on a timer while
 * nobody is using the app, so a scale-to-zero Postgres can sleep:
 *   1. Boot replay (onModuleInit): for each wallet in `smart_accounts`,
 *      stream confirmed transfers since `tailer_state.last_indexed_slot`
 *      and write them via TailerService. Catches up anything missed
 *      while the process was down.
 *   2. Per-Consumer catch-up (`catchUpUser`): the same replay for one
 *      Consumer's wallets, run when they fetch their activity, at most once
 *      per USER_CATCH_UP_INTERVAL_MS. A webhook delivery missed while the
 *      process was up is written the next time its owner opens the app.
 *   3. Pending check (`armPendingCheck`, and once at boot): for every
 *      PENDING `transfers` row older than the age threshold, ask the cluster
 *      what happened via `getSignatureStatuses` and finalize the row to
 *      CONFIRMED or FAILED. Armed when a send is submitted, re-checks every
 *      PENDING_RECHECK_MS while PENDING rows remain, and stops when none do.
 *      The status guard is enforced via the WHERE clause (`status='PENDING'`),
 *      so a row already finalized by the webhook path is untouched.
 *
 * Re-entrancy: the WHERE clauses + status guards make double-execution safe
 * (a second check finds nothing PENDING-and-old enough because the first
 * finalized them).
 */
@Injectable()
export class ReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconcilerService.name);

  // Rolling counters for the "percent of confirmations via
  // reconciliation vs webhook" metric. Reset on process restart.
  private reconcileFinalizedCount = 0;
  private webhookFinalizedCount = 0;

  private pendingTimer: NodeJS.Timeout | null = null;
  private pendingCheckRunning = false;
  private readonly lastCatchUpAt = new Map<string, number>();

  constructor(
    private readonly db: DbService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    private readonly tailer: TailerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.replayAllWallets();
    // Sends left PENDING by a restart have nobody to arm a check for them.
    await this.checkPending();
  }

  onModuleDestroy(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  /**
   * Called once a send is submitted. The first check waits until the row is
   * old enough for the tick to consider it; an already-scheduled check covers
   * this send too.
   */
  armPendingCheck(): void {
    if (this.pendingTimer) return;
    this.schedulePendingCheck(PENDING_AGE_MS);
  }

  /**
   * Finalize what can be finalized, then keep checking only while sends are
   * still PENDING. A failed check is retried rather than dropped, since the
   * rows it was looking at are still waiting.
   */
  async checkPending(): Promise<void> {
    if (this.pendingCheckRunning) return;
    this.pendingCheckRunning = true;
    let more: boolean;
    try {
      await this.tick();
      more = await this.hasRecentPending();
    } catch (err) {
      this.logger.error('tailer.reconcile.pending_check failed', err);
      more = true;
    } finally {
      this.pendingCheckRunning = false;
    }
    if (more && !this.pendingTimer) {
      this.schedulePendingCheck(PENDING_RECHECK_MS);
    }
  }

  /** Whether a timer is waiting to run the next pending check. */
  isPendingCheckArmed(): boolean {
    return this.pendingTimer !== null;
  }

  private schedulePendingCheck(delayMs: number): void {
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.checkPending();
    }, delayMs);
    // A pending check must never be what keeps the process alive.
    this.pendingTimer.unref?.();
  }

  private async hasRecentPending(): Promise<boolean> {
    const result = (await this.db.client.execute(sql`
      SELECT 1 AS pending
      FROM transfers
      WHERE status = 'PENDING'
        AND submitted_at > (now() AT TIME ZONE 'UTC') - INTERVAL '${sql.raw(`${PENDING_RECHECK_HORIZON_MS / 1000}`)} seconds'
      LIMIT 1
    `)) as unknown as { rows?: unknown[] };
    return (result.rows ?? []).length > 0;
  }

  /**
   * Replay one Consumer's wallets, so a deposit whose webhook delivery was
   * missed appears when they next look at their activity. Rate limited per
   * Consumer, and bounded in how long the caller waits: the replay carries on
   * past USER_CATCH_UP_WAIT_MS and the next fetch shows what it wrote.
   */
  async catchUpUser(userId: string, now = Date.now()): Promise<void> {
    const last = this.lastCatchUpAt.get(userId);
    if (last !== undefined && now - last < USER_CATCH_UP_INTERVAL_MS) return;
    this.lastCatchUpAt.set(userId, now);
    this.forgetCatchUpsBefore(now - USER_CATCH_UP_INTERVAL_MS);

    const run = this.replayWallets(await this.walletsOf(userId), 'catch_up');
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, USER_CATCH_UP_WAIT_MS);
      timer.unref?.();
    });
    await Promise.race([run, waited]).finally(() => clearTimeout(timer));
  }

  private forgetCatchUpsBefore(cutoff: number): void {
    for (const [userId, at] of this.lastCatchUpAt) {
      if (at < cutoff) this.lastCatchUpAt.delete(userId);
    }
  }

  /**
   * Replay any confirmed transfers that landed while the service was
   * down. Bounded by `tailer_state.last_indexed_slot` per wallet.
   */
  async replayAllWallets(): Promise<void> {
    await this.replayWallets(await this.walletsOf(), 'boot');
  }

  /**
   * Both address families, because both can receive during the migration
   * window: the vault is where a Consumer is told to deposit, and the Privy
   * wallet still holds anything sent before enrolment. Every Consumer's when
   * `userId` is omitted.
   */
  private async walletsOf(
    userId?: string,
  ): Promise<{ id: string; walletAddress: string }[]> {
    const [privyWallets, vaults] = await Promise.all([
      this.db.client
        .select({
          id: smartAccounts.id,
          walletAddress: smartAccounts.walletAddress,
        })
        .from(smartAccounts)
        .where(userId ? eq(smartAccounts.userId, userId) : undefined),
      // Keyed by the owner's smart_accounts row, not by squads_accounts.id:
      // transfers.smart_account_id is a foreign key into smart_accounts, so a
      // vault's own id violates the constraint and aborts that wallet's replay.
      this.db.client
        .select({
          id: smartAccounts.id,
          walletAddress: squadsAccounts.vaultAddress,
        })
        .from(squadsAccounts)
        .innerJoin(
          smartAccounts,
          eq(smartAccounts.userId, squadsAccounts.userId),
        )
        .where(userId ? eq(squadsAccounts.userId, userId) : undefined),
    ]);
    return [...privyWallets, ...vaults];
  }

  /**
   * Catches exceptions per wallet so a single broken wallet does not block
   * the rest.
   */
  private async replayWallets(
    wallets: { id: string; walletAddress: string }[],
    reason: 'boot' | 'catch_up',
  ): Promise<void> {
    if (wallets.length === 0) {
      this.logger.log(
        `tailer.reconcile.${reason} wallets=0 (nothing to replay)`,
      );
      return;
    }

    let totalReplayed = 0;
    for (const w of wallets) {
      try {
        const replayed = await this.replayWallet(w.id, w.walletAddress);
        totalReplayed += replayed;
      } catch (err) {
        this.logger.error(
          `tailer.reconcile.${reason} failed for ${w.walletAddress}; the owner's next activity fetch retries`,
          err,
        );
      }
    }
    this.logger.log(
      `tailer.reconcile.${reason} wallets=${wallets.length} replayed=${totalReplayed}`,
    );
  }

  /**
   * Replay a single wallet. Returns the count of events written. The
   * Failover RPC adapter falls back to the public RPC if Helius is down.
   */
  async replayPayment(
    smartAccountId: string,
    walletAddress: string,
    signature: string,
  ): Promise<number> {
    const [status] = await this.solana.getSignatureStatuses([signature]);
    if (
      status?.err ||
      status?.slot == null ||
      !['confirmed', 'finalized'].includes(status.confirmationStatus ?? '')
    ) {
      throw new Error(
        `Confirmed Payment signature not yet readable: ${signature}`,
      );
    }
    return this.replayWallet(smartAccountId, walletAddress, status.slot);
  }

  async replayWallet(
    smartAccountId: string,
    walletAddress: string,
    includeSlot?: bigint,
  ): Promise<number> {
    const [bookmark] = await this.db.client
      .select()
      .from(tailerState)
      .where(eq(tailerState.walletAddress, walletAddress))
      .limit(1);
    const bookmarkSlot = bookmark?.lastIndexedSlot ?? 0n;
    // An event can arrive after a newer webhook advanced the bookmark.
    const sinceSlot =
      includeSlot !== undefined && includeSlot < bookmarkSlot
        ? includeSlot
        : bookmarkSlot;

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

  async tick(): Promise<void> {
    const t0 = Date.now();

    // Compute the cutoff server-side using `now() AT TIME ZONE 'UTC'`,
    // which yields the current UTC wall-clock as `timestamp without time
    // zone`. The `transfers.submitted_at` column is also `timestamp
    // without time zone`, but it is written by /transfers/submit as a JS
    // Date, which Drizzle serializes via `toISOString()` — i.e. the UTC
    // wall-clock digits. Anchoring the cutoff to UTC (rather than
    // `LOCALTIMESTAMP`, which follows the server's TimeZone GUC) keeps
    // both sides of the comparison in the same zone on any deployment.
    const outstanding = (await this.db.client.execute(sql`
      SELECT
        signature,
        smart_account_id AS "smartAccountId",
        submitted_at < (now() AT TIME ZONE 'UTC') - INTERVAL '${sql.raw(`${PENDING_EXPIRY_MS / 1000}`)} seconds'
          AS "expired"
      FROM transfers
      WHERE status = 'PENDING'
        AND submitted_at < (now() AT TIME ZONE 'UTC') - INTERVAL '${sql.raw(`${PENDING_AGE_MS / 1000}`)} seconds'
      ORDER BY submitted_at ASC
      LIMIT ${sql.raw(`${RECONCILE_BATCH}`)}
    `)) as unknown as {
      rows: { signature: string; smartAccountId: string; expired: boolean }[];
    };
    const rows = outstanding.rows ?? [];
    const expiredBySignature = new Map(
      rows.map((r) => [r.signature, r.expired]),
    );

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
      } else if (
        status.confirmationStatus === null &&
        expiredBySignature.get(status.signature) === true
      ) {
        // Cluster has never seen this signature (null status, no err) and
        // the row has aged past the blockhash lifetime — the transaction
        // was dropped or its blockhash expired and will never land.
        // Finalize as FAILED so it stops occupying the oldest-first batch.
        await this.db.client.execute(sql`
          UPDATE transfers
          SET status = 'FAILED'::transfer_status,
              failure_reason = ${JSON.stringify({ code: 'BLOCKHASH_EXPIRED' })},
              confirmed_at = NOW()
          WHERE signature = ${status.signature}
            AND status = 'PENDING'
        `);
        failed++;
        this.reconcileFinalizedCount++;
      }
      // else: still in flight (or not yet aged past expiry) — leave
      // PENDING; the next check looks again.
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
