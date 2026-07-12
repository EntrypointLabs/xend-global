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
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { webhookDeliveries, webhookEndpoints } from '../db/schema';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { assertPublicHttpsUrl, UnsafeUrlError } from '../common/url-safety';
import { InternalGuard } from '../merchant/internal.guard';
import { RegisterEndpointBodySchema, type RegisterEndpointBody } from './dtos';
import {
  WebhookDeliveryNotFoundError,
  WebhookEndpointNotFoundError,
} from './webhook.errors';
import { WebhookDeliveryService } from './webhook-delivery.service';

function mintSecret(): string {
  return 'whsec_' + randomBytes(24).toString('base64url');
}

/**
 * Internal ops surfaces for webhook endpoint management. Not a merchant key,
 * not the consumer JWT: guarded by INTERNAL_API_SECRET. Merchants never manage
 * endpoints themselves in v1 (the merchants.xend.global portal is the
 * fast-follow that calls these).
 */
@Controller('internal')
@UseGuards(InternalGuard)
export class WebhookAdminController {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  @Post('webhook_endpoints')
  async register(
    @Body(new ZodValidationPipe(RegisterEndpointBodySchema))
    body: RegisterEndpointBody,
  ) {
    try {
      const allowPrivate =
        this.config.get<boolean>('WEBHOOK_ALLOW_PRIVATE_URLS') ?? false;
      await assertPublicHttpsUrl(body.url, { allowPrivate });

      const secret = mintSecret();
      const [row] = await this.db.client
        .insert(webhookEndpoints)
        .values({
          merchantId: body.merchant_id,
          url: body.url,
          secretPrimary: secret,
          eventTypes: body.event_types ?? null,
          mode: body.mode,
        })
        .returning();

      return {
        id: row.id,
        url: row.url,
        mode: row.mode,
        event_types: row.eventTypes,
        secret,
      };
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  @Get('merchants/:merchantId/webhook_endpoints')
  async list(@Param('merchantId') merchantId: string) {
    const rows = await this.db.client
      .select({
        id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        mode: webhookEndpoints.mode,
        enabled: webhookEndpoints.enabled,
        eventTypes: webhookEndpoints.eventTypes,
        createdAt: webhookEndpoints.createdAt,
      })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.merchantId, merchantId));
    return { data: rows };
  }

  @Post('webhook_endpoints/:id/rotate_secret')
  async rotateSecret(@Param('id') id: string) {
    try {
      const [endpoint] = await this.db.client
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, id))
        .limit(1);
      if (!endpoint) {
        throw new WebhookEndpointNotFoundError(`endpoint ${id} not found`);
      }
      const secret = mintSecret();
      // Move the current primary to secondary so both verify during the
      // overlap window, then set the new primary.
      await this.db.client
        .update(webhookEndpoints)
        .set({
          secretSecondary: endpoint.secretPrimary,
          secretPrimary: secret,
          updatedAt: new Date(),
        })
        .where(eq(webhookEndpoints.id, id));
      return { id, secret };
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
