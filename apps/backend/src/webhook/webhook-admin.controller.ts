import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { webhookDeliveries } from '../db/schema';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UnsafeUrlError } from '../common/url-safety';
import { InternalGuard } from '../merchant/internal.guard';
import { RegisterEndpointBodySchema, type RegisterEndpointBody } from './dtos';
import {
  WebhookDeliveryNotFoundError,
  WebhookEndpointNotFoundError,
} from './webhook.errors';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookEndpointService } from './webhook-endpoint.service';

/**
 * Internal ops surfaces for webhook endpoint management. Not a merchant key,
 * not the consumer JWT: guarded by INTERNAL_API_SECRET. Merchants manage
 * their own endpoints through /v1/webhook_endpoints; this surface exists for
 * ops to act on any Merchant's behalf.
 */
@Controller('internal')
@UseGuards(InternalGuard)
export class WebhookAdminController {
  constructor(
    private readonly db: DbService,
    private readonly endpoints: WebhookEndpointService,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  @Post('webhook_endpoints')
  async register(
    @Body(new ZodValidationPipe(RegisterEndpointBodySchema))
    body: RegisterEndpointBody,
  ) {
    try {
      const { endpoint, secret } = await this.endpoints.register({
        merchantId: body.merchant_id,
        url: body.url,
        mode: body.mode,
        eventTypes: body.event_types,
      });
      return {
        id: endpoint.id,
        url: endpoint.url,
        mode: endpoint.mode,
        event_types: endpoint.eventTypes,
        secret,
      };
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  @Get('merchants/:merchantId/webhook_endpoints')
  async list(@Param('merchantId') merchantId: string) {
    const rows = await this.endpoints.list({ merchantId });
    return {
      data: rows.map((row) => ({
        id: row.id,
        url: row.url,
        mode: row.mode,
        enabled: row.enabled,
        eventTypes: row.eventTypes,
        createdAt: row.createdAt,
      })),
    };
  }

  @Post('webhook_endpoints/:id/rotate_secret')
  async rotateSecret(@Param('id') id: string) {
    try {
      const { secret, secondaryExpiresAt } =
        await this.endpoints.rotateSecret(id);
      return {
        id,
        secret,
        secondary_expires_at: secondaryExpiresAt.toISOString(),
      };
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  @Post('webhook_deliveries/:id/redeliver')
  async redeliver(@Param('id') id: string) {
    try {
      const [existing] = await this.db.client
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, id))
        .limit(1);
      if (!existing) {
        throw new WebhookDeliveryNotFoundError(`delivery ${id} not found`);
      }
      // A manual redelivery reuses the SAME event id (so merchant-side dedup
      // still collapses it) but is exempt from the auto partial-unique index,
      // so a fresh attempt row is always created. This is what the P2 console
      // calls.
      const created = await this.delivery.createDelivery({
        endpointId: existing.endpointId,
        eventId: existing.eventId,
        eventType: existing.eventType,
        payload: existing.payload,
        correlationId: existing.correlationId,
        origin: 'manual',
      });
      if (created) await this.delivery.attempt(created);
      return { redelivered: true, deliveryId: created?.id ?? null };
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  protected mapServiceError(err: unknown): never {
    if (err instanceof UnsafeUrlError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      err instanceof WebhookEndpointNotFoundError ||
      err instanceof WebhookDeliveryNotFoundError
    ) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.NOT_FOUND,
      );
    }
    throw err as Error;
  }
}
