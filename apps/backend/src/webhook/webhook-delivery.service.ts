import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { webhookDeliveries, webhookEndpoints } from '../db/schema';
import { assertPublicHttpsUrl } from '../common/url-safety';
import { signWebhook } from './webhook-signer';

type DeliveryRow = typeof webhookDeliveries.$inferSelect;

export interface CreateDeliveryParams {
  endpointId: string;
  eventId: string;
  eventType: string;
  payload: string;
  correlationId: string;
  origin: 'event' | 'manual';
}

/**
 * Signs and delivers one webhook attempt, and records the outcome. Delivery
 * is at-least-once: the retry sweep re-attempts failed rows and the merchant
 * dedups on the stable event id. The SSRF guard is re-run at delivery time
 * (rebinding defense) and redirects are refused.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  /**
   * INSERT a delivery row. For origin='event' this is idempotent under the
   * partial unique index (returns null when a row already exists, so a Kafka
   * re-consume does not enqueue a second delivery). Manual redeliveries always
   * insert a fresh row.
   */
  async createDelivery(
    params: CreateDeliveryParams,
  ): Promise<DeliveryRow | null> {
    const [row] = await this.db.client
      .insert(webhookDeliveries)
      .values({
        endpointId: params.endpointId,
        eventId: params.eventId,
        eventType: params.eventType,
        payload: params.payload,
        correlationId: params.correlationId,
        origin: params.origin,
      })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  async attempt(delivery: DeliveryRow): Promise<void> {
    const [endpoint] = await this.db.client
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, delivery.endpointId))
      .limit(1);
    if (!endpoint) {
      await this.recordFailure(delivery, null, 'endpoint missing', 0);
      return;
    }

    const allowPrivate =
      this.config.get<boolean>('WEBHOOK_ALLOW_PRIVATE_URLS') ?? false;
    const timeoutMs = this.config.getOrThrow<number>(
      'WEBHOOK_DELIVERY_TIMEOUT_MS',
    );
    const bodyMax = this.config.getOrThrow<number>('WEBHOOK_RESPONSE_BODY_MAX');

    const header = signWebhook(delivery.payload, [
      endpoint.secretPrimary,
      ...(endpoint.secretSecondary ? [endpoint.secretSecondary] : []),
    ]);

    const t0 = Date.now();
    try {
      // Re-run the SSRF guard at delivery time (DNS-rebinding defense).
      await assertPublicHttpsUrl(endpoint.url, { allowPrivate });

      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Xend-Signature': header,
          'Xend-Event-Id': delivery.eventId,
          'X-Correlation-Id': delivery.correlationId,
        },
        body: delivery.payload,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const durationMs = Date.now() - t0;
      const bodyText = (await res.text()).slice(0, bodyMax);

      if (res.status >= 200 && res.status < 300) {
        await this.db.client
          .update(webhookDeliveries)
          .set({
            status: 'succeeded',
            responseStatus: res.status,
            responseBody: bodyText,
            durationMs,
            nextRetryAt: null,
          })
          .where(eq(webhookDeliveries.id, delivery.id));
        this.log(delivery, res.status, 'succeeded', durationMs);
        return;
      }

      await this.recordFailure(delivery, res.status, bodyText, durationMs);
    } catch (err) {
      const durationMs = Date.now() - t0;
      // A refused redirect, network error, SSRF rejection, or timeout all land
      // here. The response body is never interpreted.
      await this.recordFailure(
        delivery,
        null,
        err instanceof Error ? err.message.slice(0, 256) : 'error',
        durationMs,
      );
    }
  }

  private async recordFailure(
    delivery: DeliveryRow,
    responseStatus: number | null,
    responseBody: string,
    durationMs: number,
  ): Promise<void> {
    const maxAttempts = this.config.getOrThrow<number>('WEBHOOK_MAX_ATTEMPTS');
    if (delivery.attemptNo >= maxAttempts) {
      await this.db.client
        .update(webhookDeliveries)
        .set({
          status: 'exhausted',
          responseStatus,
          responseBody,
          durationMs,
          nextRetryAt: null,
        })
        .where(eq(webhookDeliveries.id, delivery.id));
      this.logger.warn(
        `webhook.exhausted delivery_id=${delivery.id} event_id=${delivery.eventId} endpoint_id=${delivery.endpointId}`,
      );
      this.log(delivery, responseStatus, 'exhausted', durationMs);
      return;
    }

    const nextRetryAt = new Date(
      Date.now() + this.backoff(delivery.attemptNo) * 1000,
    );
    await this.db.client
      .update(webhookDeliveries)
      .set({
        status: 'failed',
        responseStatus,
        responseBody,
        durationMs,
        nextRetryAt,
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    this.log(delivery, responseStatus, 'failed', durationMs);
  }

  /** Exponential backoff with +/- 20% jitter, capped. Seconds. */
  backoff(attemptNo: number): number {
    const base = this.config.getOrThrow<number>('WEBHOOK_RETRY_BASE_SECONDS');
    const max = this.config.getOrThrow<number>('WEBHOOK_RETRY_MAX_SECONDS');
    const raw = base * 2 ** (attemptNo - 1);
    const capped = Math.min(raw, max);
    const jitter = capped * (Math.random() * 0.4 - 0.2);
    return Math.max(1, Math.round(capped + jitter));
  }

  private log(
    delivery: DeliveryRow,
    statusCode: number | null,
    outcome: string,
    durationMs: number,
  ): void {
    this.logger.log(
      `webhook.deliver event_id=${delivery.eventId} endpoint_id=${delivery.endpointId} attempt=${delivery.attemptNo} status_code=${statusCode ?? '-'} outcome=${outcome} duration_ms=${durationMs}`,
    );
  }
}
