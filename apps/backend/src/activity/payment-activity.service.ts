import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import {
  payments,
  paymentIntents,
  smartAccounts,
  squadsAccounts,
  transfers,
} from '../db/schema';
import {
  EVENT_CONSUMER,
  type EventConsumer,
} from '../events/event-consumer.interface';
import type { PlatformEvent } from '../events/event-publisher.interface';
import { ReconcilerService } from './reconciler.service';

/** Index confirmed Payments promptly even when the chain webhook is delayed.
 * Uses the existing chain reader and idempotent Activity writer, never an
 * optimistic transfer assembled from the event payload. Independent Kafka
 * group: Merchant webhook delivery must still receive the same event.
 */
@Injectable()
export class PaymentActivityService implements OnModuleInit {
  private readonly logger = new Logger(PaymentActivityService.name);
  private readonly executionCluster: string;
  private repairing = false;

  constructor(
    @Inject(EVENT_CONSUMER) private readonly consumer: EventConsumer,
    private readonly db: DbService,
    private readonly reconciler: ReconcilerService,
    config: ConfigService,
  ) {
    this.executionCluster = config.getOrThrow<string>('SOLANA_CLUSTER');
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.subscribe(
      ['payment.succeeded'],
      `payment-activity-indexer-${this.executionCluster}`,
      (event) => this.handle(event),
    );
  }

  async handle(event: PlatformEvent): Promise<void> {
    if (event.topic !== 'payment.succeeded') return;
    const [payment] = await this.db.client
      .select({
        accountId: smartAccounts.id,
        vaultAddress: squadsAccounts.vaultAddress,
        signature: payments.txSignature,
        executionCluster: paymentIntents.executionCluster,
      })
      .from(payments)
      .innerJoin(paymentIntents, eq(paymentIntents.id, payments.intentId))
      .innerJoin(smartAccounts, eq(smartAccounts.userId, payments.consumerId))
      .innerJoin(squadsAccounts, eq(squadsAccounts.userId, payments.consumerId))
      .where(eq(payments.intentId, event.key))
      .limit(1);
    if (
      !payment?.signature ||
      payment.executionCluster !== this.executionCluster ||
      /^(test_|devtest_)/.test(payment.signature)
    )
      return;

    // Rewind to the recorded signature when a newer webhook has already
    // advanced the bookmark. Still replay intervening legs in order.
    await this.reconciler.replayPayment(
      payment.accountId,
      payment.vaultAddress,
      payment.signature,
    );
    const [indexed] = await this.db.client
      .select({ id: transfers.id })
      .from(transfers)
      .where(
        and(
          eq(transfers.signature, payment.signature),
          eq(transfers.smartAccountId, payment.accountId),
          eq(transfers.status, 'CONFIRMED'),
          eq(transfers.kind, 'payment'),
        ),
      )
      .limit(1);
    // A confirmed transaction can lag on a different RPC reader. Do not ack
    // this event until the Activity exists; event retries and the sweep heal it.
    if (!indexed)
      throw new Error(
        `Confirmed Payment Activity not yet indexed: ${event.key}`,
      );
  }

  /**
   * Kafka provides prompt indexing, while the durable payments table provides
   * the retry source of truth. This sweep keeps repairing confirmed payments
   * that still lack Activity even after Kafka exhausts and dead-letters an
   * event during a prolonged RPC/indexer outage.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async repairMissingPayments(): Promise<void> {
    if (this.repairing) return;
    this.repairing = true;
    try {
      const result = (await this.db.client.execute(sql`
        SELECT
          p.intent_id AS "intentId",
          p.tx_signature AS "signature",
          sa.id AS "accountId",
          sq.vault_address AS "vaultAddress"
        FROM payments p
        JOIN payment_intents pi ON pi.id = p.intent_id
        JOIN smart_accounts sa ON sa.user_id = p.consumer_id
        JOIN squads_accounts sq ON sq.user_id = p.consumer_id
        LEFT JOIN transfers t
          ON t.signature = p.tx_signature
          AND t.smart_account_id = sa.id
          AND t.status = 'CONFIRMED'
          AND t.kind = 'payment'
        WHERE pi.execution_cluster = ${this.executionCluster}
          AND t.id IS NULL
          AND LEFT(p.tx_signature, 5) <> 'test_'
          AND LEFT(p.tx_signature, 8) <> 'devtest_'
        ORDER BY p.settled_at ASC
        LIMIT 100
      `)) as unknown as {
        rows: Array<{
          intentId: string;
          signature: string;
          accountId: string;
          vaultAddress: string;
        }>;
      };

      for (const payment of result.rows) {
        try {
          await this.reconciler.replayPayment(
            payment.accountId,
            payment.vaultAddress,
            payment.signature,
          );
        } catch (error) {
          this.logger.warn(
            `payment.activity.repair_failed intent_id=${payment.intentId} signature=${payment.signature}`,
            error,
          );
        }
      }
      if (result.rows.length > 0) {
        this.logger.log(
          `payment.activity.repair attempted=${result.rows.length}`,
        );
      }
    } finally {
      this.repairing = false;
    }
  }
}
