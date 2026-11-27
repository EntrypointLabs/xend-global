import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type {
  EventPublisher,
  PlatformEvent,
} from '../events/event-publisher.interface';
import { bucketNgnMinor, bucketUsdcRaw, reasonCode } from './redact';
import type { EventSubject, ServerAnalytics } from './server-analytics.service';
import type { ServerEventName, ServerEventProps } from './server-events';

type Mapped = {
  event: ServerEventName;
  subject: EventSubject;
  props: ServerEventProps;
};

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v : undefined;

/**
 * Picks the analytics-safe fields out of a platform event. An allowlist per
 * topic rather than a pass-through: payloads carry signatures, provider
 * references and exact amounts that must not reach analytics.
 */
export function mapPlatformEvent(event: PlatformEvent): Mapped | null {
  const p = event.payload;
  const merchantId = str(p.merchantId);
  const consumerId = str(p.consumerId);
  const intentId = str(p.intentId);
  const subject: EventSubject = consumerId
    ? { consumerId }
    : merchantId
      ? { merchantId }
      : { anonymous: `intent:${intentId ?? event.key}` };
  const base: ServerEventProps = {
    merchant_id: merchantId,
    intent_id: intentId,
  };

  switch (event.topic) {
    case 'payment.created':
      return {
        event: 'server_payment_created',
        subject,
        props: {
          ...base,
          amount_bucket: bucketUsdcRaw(p.usdcSettlementRaw as string),
          currency: str(p.displayCurrency),
        },
      };
    case 'payment.authorized':
      return {
        event: 'server_payment_authorized',
        subject,
        props: {
          ...base,
          amount_bucket: bucketUsdcRaw(p.usdcSettlementRaw as string),
        },
      };
    case 'payment.succeeded':
      return {
        event: 'server_payment_succeeded',
        subject,
        props: {
          ...base,
          payment_id: str(p.paymentId),
          amount_bucket: bucketUsdcRaw(p.usdcSettlementRaw as string),
          rail: p.ngnSettledMinor != null ? 'ngn' : 'usdc',
        },
      };
    case 'payment.failed':
      return {
        event: 'server_payment_failed',
        subject,
        props: { ...base, reason: reasonCode(p.reason) },
      };
    case 'payment.expired':
      return { event: 'server_payment_expired', subject, props: base };
    case 'payment.canceled':
      return {
        event: 'server_payment_canceled',
        subject,
        props: { ...base, reason: reasonCode(p.reason) },
      };
    case 'payout.initiated':
      return {
        event: 'server_payout_initiated',
        subject,
        props: {
          ...base,
          payment_id: str(p.paymentId),
          amount_bucket: bucketUsdcRaw(p.usdcAmountRaw as string),
        },
      };
    case 'payout.completed':
      return {
        event: 'server_payout_completed',
        subject,
        props: {
          ...base,
          payment_id: str(p.paymentId),
          amount_bucket: bucketNgnMinor(p.ngnSettledMinor as string),
          currency: 'NGN',
        },
      };
    case 'payout.failed':
      return {
        event: 'server_payout_failed',
        subject,
        props: {
          ...base,
          payment_id: str(p.paymentId),
          reason: reasonCode(p.reason ?? p.code),
        },
      };
    case 'session.issued':
      return { event: 'server_merchant_connected', subject, props: base };
    case 'session.revoked':
      return { event: 'server_merchant_disconnected', subject, props: base };
    default:
      return null;
  }
}

type Lifecycle = {
  onModuleInit?(): unknown;
  onApplicationShutdown?(signal?: string): unknown;
};

/**
 * Wraps whichever publisher is bound (Kafka or the logging stand-in) so every
 * platform event is also counted, whether or not a broker is configured.
 *
 * Nest runs lifecycle hooks only on the object a factory returns, so the
 * wrapper forwards them: without that the Kafka producer never connects.
 */
export class AnalyticsEventPublisher
  implements EventPublisher, OnModuleInit, OnApplicationShutdown
{
  constructor(
    readonly inner: EventPublisher,
    private readonly analytics: ServerAnalytics,
  ) {}

  async onModuleInit(): Promise<void> {
    await (this.inner as Lifecycle).onModuleInit?.();
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    await (this.inner as Lifecycle).onApplicationShutdown?.(signal);
  }

  async publish(event: PlatformEvent): Promise<void> {
    await this.inner.publish(event);
    if (!this.analytics.enabled) return;
    try {
      const mapped = mapPlatformEvent(event);
      if (mapped)
        this.analytics.capture(mapped.event, mapped.subject, mapped.props);
    } catch {
      // A mapping bug must not turn a published event into a failed request.
    }
  }
}
