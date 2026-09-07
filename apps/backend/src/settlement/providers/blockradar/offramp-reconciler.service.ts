import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { DbService } from '../../../db/db.service';
import { settlementOfframps } from '../../../db/schema';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../events/event-publisher.interface';

const BATCH = 100;
const TIMEOUT_REASON = JSON.stringify({ code: 'OFFRAMP_TIMEOUT' });

/**
 * A naira off-ramp only leaves pending or converting when Blockradar's
 * webhook says so. If that webhook never arrives, the off-ramp row and the
 * Payment behind it sit in settling forever. After
 * SETTLEMENT_OFFRAMP_STUCK_MINUTES of silence the row is failed and
 * payout.failed published, the same outcome a delivered failure webhook has.
 *
 * The Payment's intent is left alone on purpose: its USDC already landed in
 * the settlement endpoint, so telling the merchant the Payment failed would be
 * wrong. The warning log is the ops signal to settle it by hand.
 */
@Injectable()
export class OfframpReconcilerService {
  private readonly logger = new Logger(OfframpReconcilerService.name);

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    const stuckMinutes =
      this.config.get<number>('SETTLEMENT_OFFRAMP_STUCK_MINUTES') ?? 120;
    const staleBefore = new Date(Date.now() - stuckMinutes * 60_000);

    const stuck = await this.db.client
      .select({
        id: settlementOfframps.id,
        status: settlementOfframps.status,
      })
      .from(settlementOfframps)
      .where(
        and(
          eq(settlementOfframps.direction, 'settlement'),
          inArray(settlementOfframps.status, ['pending', 'converting']),
          lt(settlementOfframps.updatedAt, staleBefore),
        ),
      )
      .orderBy(asc(settlementOfframps.updatedAt))
      .limit(BATCH);

    for (const row of stuck) {
      // Conditional on the status it was selected under, so a webhook that
      // lands between the select and this write wins.
      const updated = await this.db.client
        .update(settlementOfframps)
        .set({
          status: 'failed',
          failureReason: TIMEOUT_REASON,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(settlementOfframps.id, row.id),
            eq(settlementOfframps.status, row.status),
          ),
        )
        .returning({
          id: settlementOfframps.id,
          merchantId: settlementOfframps.merchantId,
          paymentId: settlementOfframps.paymentId,
        });
      if (updated.length === 0) continue;
      const offramp = updated[0];

      this.logger.warn(
        `settlement.offramp.timeout offramp_id=${offramp.id} merchant_id=${offramp.merchantId} payment_id=${offramp.paymentId ?? '-'} stuck_minutes=${stuckMinutes}`,
      );
      await this.events.publish({
        topic: 'payout.failed',
        key: offramp.id,
        payload: {
          offrampId: offramp.id,
          merchantId: offramp.merchantId,
          paymentId: offramp.paymentId,
          reason: 'OFFRAMP_TIMEOUT',
        },
        correlationId: offramp.id,
      });
    }
  }
}
