import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import {
  payments,
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
  constructor(
    @Inject(EVENT_CONSUMER) private readonly consumer: EventConsumer,
    private readonly db: DbService,
    private readonly reconciler: ReconcilerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumer.subscribe(
      ['payment.succeeded'],
      'payment-activity-indexer',
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
      })
      .from(payments)
      .innerJoin(smartAccounts, eq(smartAccounts.userId, payments.consumerId))
      .innerJoin(squadsAccounts, eq(squadsAccounts.userId, payments.consumerId))
      .where(eq(payments.intentId, event.key))
      .limit(1);
    if (!payment?.signature || /^(test_|devtest_)/.test(payment.signature))
      return;

    // Replay from the durable bookmark, not just this signature: skipping
    // earlier legs would advance the shared bookmark past unseen activity.
    await this.reconciler.replayWallet(payment.accountId, payment.vaultAddress);
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
}
