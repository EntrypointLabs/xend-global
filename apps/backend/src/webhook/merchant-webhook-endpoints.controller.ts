import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UnsafeUrlError } from '../common/url-safety';
import { ApiKeyGuard, type MerchantRequest } from '../merchant/api-key.guard';
import { DbService } from '../db/db.service';
import { MerchantAuditService } from '../merchant/merchant-audit.service';
import {
  CreateMerchantEndpointBodySchema,
  type CreateMerchantEndpointBody,
  type WebhookEndpointObject,
} from './dtos';
import {
  WebhookEndpointNotFoundError,
  WebhookSecretRotationConflictError,
} from './webhook.errors';
import {
  WebhookEndpointService,
  type EndpointRow,
} from './webhook-endpoint.service';

/**
 * Merchant self-serve endpoint management under the API key. Every read and
 * write is scoped to the key's Merchant and mode: a test key registers and
 * sees test endpoints only, so a sandbox integration can never receive, or
 * retire, a live delivery target.
 */
@Controller('v1/webhook_endpoints')
@UseGuards(ApiKeyGuard)
export class MerchantWebhookEndpointsController {
  constructor(
    private readonly endpoints: WebhookEndpointService,
    private readonly db: DbService,
    private readonly audit: MerchantAuditService,
  ) {}

  // A mutation through an integration key is as sensitive as one through the
  // portal: it can redirect deliveries or roll a signing secret. Attribute it
  // to the key so the owner-visible Activity log records who changed what.
  private actor(req: MerchantRequest): string {
    return `api_key:${req.merchant.apiKeyId}`;
  }

  @Get()
  async list(
    @Req() req: MerchantRequest,
  ): Promise<{ object: 'list'; data: WebhookEndpointObject[] }> {
    const rows = await this.endpoints.list({
      merchantId: req.merchant.merchantId,
      mode: req.merchant.deliveryMode,
    });
    return { object: 'list', data: rows.map(toObject) };
  }

  @Post()
  async create(
    @Req() req: MerchantRequest,
    @Body(new ZodValidationPipe(CreateMerchantEndpointBodySchema))
    body: CreateMerchantEndpointBody,
  ): Promise<WebhookEndpointObject> {
    try {
      // Resolve the URL before the transaction so its unbounded DNS lookup does
      // not hold a pooled connection, then create and audit atomically.
      await this.endpoints.assertUrlSafe(body.url);
      const { endpoint, secret } = await this.db.client.transaction(
        async (tx) => {
          const created = await this.endpoints.register(
            {
              merchantId: req.merchant.merchantId,
              mode: req.merchant.deliveryMode,
              url: body.url,
              eventTypes: body.event_types,
            },
            tx,
            { skipUrlCheck: true },
          );
          await this.audit.record(
            {
              merchantId: req.merchant.merchantId,
              actor: this.actor(req),
              action: 'webhook.create',
              target: created.endpoint.id,
              metadata: {
                url: created.endpoint.url,
                mode: created.endpoint.mode,
              },
            },
            tx,
          );
          return created;
        },
      );
      return { ...toObject(endpoint), secret };
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  @Post(':id/rotate_secret')
  async rotateSecret(
    @Req() req: MerchantRequest,
    @Param('id') id: string,
  ): Promise<WebhookEndpointObject> {
    try {
      const scope = {
        merchantId: req.merchant.merchantId,
        mode: req.merchant.deliveryMode,
      };
      const { endpoint, secret, secondaryExpiresAt } =
        await this.db.client.transaction(async (tx) => {
          const rotated = await this.endpoints.rotateSecret(id, scope, tx);
          const found = await this.endpoints.find(id, scope, tx);
          await this.audit.record(
            {
              merchantId: req.merchant.merchantId,
              actor: this.actor(req),
              action: 'webhook.rotate_secret',
              target: id,
              metadata: { url: found.url },
            },
            tx,
          );
          return { endpoint: found, ...rotated };
        });
      return {
        ...toObject(endpoint),
        secret,
        previous_secret_expires_at: secondaryExpiresAt.toISOString(),
      };
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  @Delete(':id')
  async remove(
    @Req() req: MerchantRequest,
    @Param('id') id: string,
  ): Promise<{ id: string; object: 'webhook_endpoint'; deleted: true }> {
    try {
      const scope = {
        merchantId: req.merchant.merchantId,
        mode: req.merchant.deliveryMode,
      };
      const endpoint = await this.db.client.transaction(async (tx) => {
        const disabled = await this.endpoints.disable(id, scope, tx);
        // Only the request that actually disabled the endpoint records the
        // audit entry, so a concurrent double-delete does not log twice.
        if (disabled.claimed)
          await this.audit.record(
            {
              merchantId: req.merchant.merchantId,
              actor: this.actor(req),
              action: 'webhook.delete',
              target: id,
              metadata: { url: disabled.endpoint.url },
            },
            tx,
          );
        return disabled.endpoint;
      });
      return { id: endpoint.id, object: 'webhook_endpoint', deleted: true };
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  private mapServiceError(err: unknown): never {
    if (err instanceof UnsafeUrlError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (err instanceof WebhookEndpointNotFoundError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.NOT_FOUND,
      );
    }
    if (err instanceof WebhookSecretRotationConflictError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.CONFLICT,
      );
    }
    throw err as Error;
  }
}

function toObject(row: EndpointRow): WebhookEndpointObject {
  return {
    id: row.id,
    object: 'webhook_endpoint',
    url: row.url,
    event_types: row.eventTypes,
    livemode: row.mode === 'live',
    created: Math.floor(row.createdAt.getTime() / 1000),
  };
}
