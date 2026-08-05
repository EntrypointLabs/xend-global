import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { webhookDeliveries } from '../db/schema';
import { WebhookDeliveryService } from './webhook-delivery.service';

const RETRY_BATCH = 50;

/**
 * Re-attempts due, failed deliveries. Race-safe like reconciler.service.ts:
 * each row is claimed with a conditional UPDATE guarded on status='failed', so
 * two instances cannot both take it. The DB rows plus per-row backoff ARE the
 * queue; there is no shared in-memory queue and no head-of-line blocking.
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
  ) {}

  @Cron('*/30 * * * * *')
  async tick(): Promise<void> {
    const due = await this.db.client
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, 'failed'),
          lte(webhookDeliveries.nextRetryAt, new Date()),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextRetryAt))
      .limit(RETRY_BATCH);

    let attempted = 0;
    for (const row of due) {
      // Conditional claim: only the instance whose UPDATE matches status
      // 'failed' proceeds; a concurrent sweep gets rowCount 0 and skips.
      const claimed = await this.db.client
        .update(webhookDeliveries)
        .set({
          attemptNo: sql`${webhookDeliveries.attemptNo} + 1`,
          status: 'pending',
        })
        .where(
          and(
            eq(webhookDeliveries.id, row.id),
            eq(webhookDeliveries.status, 'failed'),
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
