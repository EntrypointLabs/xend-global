import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, lt, lte, or, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { webhookDeliveries } from '../db/schema';
import { WebhookDeliveryService } from './webhook-delivery.service';

const RETRY_BATCH = 50;

/**
 * Re-attempts due, failed deliveries, and deliveries left pending by a crash
 * between creation and the attempt's outcome write. Race-safe like
 * reconciler.service.ts: each row is claimed with a conditional UPDATE guarded
 * on the status it was selected under, so two instances cannot both take it.
 * The DB rows plus per-row backoff ARE the queue; there is no shared
 * in-memory queue and no head-of-line blocking.
 *
 * The schedule module is registered app-wide once in activity.module.ts;
 * this service only adds a @Cron handler and must not register it again.
 */
@Injectable()
export class WebhookRetryService {
  private readonly logger = new Logger(WebhookRetryService.name);

  constructor(
    private readonly db: DbService,
    private readonly delivery: WebhookDeliveryService,
    private readonly config: ConfigService,
  ) {}

  @Cron('*/30 * * * * *')
  async tick(): Promise<void> {
    const now = new Date();
    const staleMinutes =
      this.config.get<number>('WEBHOOK_PENDING_STALE_MINUTES') ?? 10;
    const staleBefore = new Date(now.getTime() - staleMinutes * 60_000);
    const due = await this.db.client
      .select()
      .from(webhookDeliveries)
      .where(
        or(
          and(
            eq(webhookDeliveries.status, 'failed'),
            lte(webhookDeliveries.nextRetryAt, now),
          ),
          and(
            eq(webhookDeliveries.status, 'pending'),
            lt(webhookDeliveries.createdAt, staleBefore),
          ),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextRetryAt))
      .limit(RETRY_BATCH);

    let attempted = 0;
    for (const row of due) {
      // Conditional claim: only the instance whose UPDATE matches the status
      // the row was selected under proceeds; a concurrent sweep gets rowCount
      // 0 and skips. A stale pending row is claimed by stamping next_retry_at
      // forward, so the next sweep leaves it alone while this attempt runs.
      const claimed = await this.db.client
        .update(webhookDeliveries)
        .set(
          row.status === 'failed'
            ? {
                attemptNo: sql`${webhookDeliveries.attemptNo} + 1`,
                status: 'pending',
              }
            : { nextRetryAt: new Date(now.getTime() + staleMinutes * 60_000) },
        )
        .where(
          and(
            eq(webhookDeliveries.id, row.id),
            eq(webhookDeliveries.status, row.status),
            row.status === 'failed'
              ? lte(webhookDeliveries.nextRetryAt, now)
              : lt(webhookDeliveries.createdAt, staleBefore),
          ),
        )
        .returning({ id: webhookDeliveries.id });
      if (claimed.length === 0) continue;

      const [reloaded] = await this.db.client
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, row.id))
        .limit(1);
      if (reloaded) {
        await this.delivery.attempt(reloaded);
        attempted++;
      }
    }

    if (attempted > 0) {
      this.logger.log(`webhook.retry.sweep attempted=${attempted}`);
    }
  }
}
