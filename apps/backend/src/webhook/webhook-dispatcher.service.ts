import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import {
  paymentIntents,
  payments,
  settlementAccounts,
  webhookEndpoints,
} from '../db/schema';
import { EVENT_CONSUMER } from '../events/event-consumer.interface';
import type { EventConsumer } from '../events/event-consumer.interface';
import type { PlatformEvent } from '../events/event-publisher.interface';
import { WebhookDeliveryService } from './webhook-delivery.service';
import {
  buildEventId,
  buildEventPayload,
  type EventSettlement,
} from './webhook-events';

const SUBSCRIBED_TOPICS = [
  'payment.succeeded',
  'payment.failed',
  'payment.expired',
];

/**
 * Materializes merchant webhook deliveries ONLY from consumed Kafka
 * lifecycle events (REQ-WEBHOOK-TRUTH): payment.succeeded/failed from Phase
 * 4's settlement confirmation, payment.expired from Phase 2's cron. Never
 * from submission or the merchant API. The snapshot is loaded from Postgres
 * by intent id, so it is decoupled from Phase 4's exact event payload.
 * Idempotent under re-consume via the deterministic event id + the partial
 * unique index.
 */
@Injectable()
export class WebhookDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    @Inject(EVENT_CONSUMER) private readonly consumer: EventConsumer,
    private readonly db: DbService,
    private readonly delivery: WebhookDeliveryService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const group = this.config.getOrThrow<string>('WEBHOOK_CONSUMER_GROUP');
    await this.consumer.subscribe(SUBSCRIBED_TOPICS, group, (e) =>
      this.handle(e),
    );
  }

  async handle(event: PlatformEvent): Promise<void> {
    const intentId = event.key;
    const [intent] = await this.db.client
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    if (!intent) {
      this.logger.warn(
        `webhook.dispatch.skip reason=intent_absent key=${intentId}`,
      );
      return;
    }

    const type = event.topic;
    let payment: typeof payments.$inferSelect | null = null;
    if (type === 'payment.succeeded' || type === 'payment.failed') {
      const [row] = await this.db.client
        .select()
        .from(payments)
        .where(eq(payments.intentId, intentId))
        .limit(1);
      // Phase 4 commits the payments row before publishing; a throw here
      // covers the rare race by leaving the offset uncommitted for redelivery.
      if (!row) {
        throw new Error(
          `payments row for intent ${intentId} not yet committed`,
        );
      }
      payment = row;
    }

    const eventId = buildEventId(type, intentId);
    const correlationId = event.correlationId ?? intentId;
    const livemode = intent.mode === 'live';

    const [account] = await this.db.client
      .select()
      .from(settlementAccounts)
      .where(eq(settlementAccounts.merchantId, intent.merchantId))
      .limit(1);
    const settlement: EventSettlement = {
      provider: account?.provider ?? null,
      currency: account?.currency ?? null,
      status: type === 'payment.succeeded' ? 'complete' : 'pending',
      completedAt: null,
      providerReference: account?.providerReference ?? null,
      ngnSettledMinor: null,
    };

    const endpoints = await this.db.client
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.merchantId, intent.merchantId),
          eq(webhookEndpoints.enabled, true),
          eq(webhookEndpoints.mode, intent.mode),
        ),
      );

    const matching = endpoints.filter(
      (e) => !e.eventTypes || e.eventTypes.includes(type),
    );

    for (const endpoint of matching) {
      const payload = JSON.stringify(
        buildEventPayload({
          eventId,
          type,
          livemode,
          correlationId,
          intent,
          payment,
          settlement,
        }),
      );
      const created = await this.delivery.createDelivery({
        endpointId: endpoint.id,
        eventId,
        eventType: type,
        payload,
        correlationId,
        origin: 'event',
      });
      // Only a newly-materialized row is attempted; a re-consume collapses on
      // the partial unique index (createDelivery returns null).
      if (created) await this.delivery.attempt(created);
    }

    this.logger.log(
      `webhook.dispatch event_id=${eventId} type=${type} intent_id=${intentId} endpoints=${matching.length}`,
    );
  }
}
