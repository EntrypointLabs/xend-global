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
import {
  CreateMerchantEndpointBodySchema,
  type CreateMerchantEndpointBody,
  type WebhookEndpointObject,
} from './dtos';
import { WebhookEndpointNotFoundError } from './webhook.errors';
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
  constructor(private readonly endpoints: WebhookEndpointService) {}

  @Get()
  async list(
    @Req() req: MerchantRequest,
  ): Promise<{ object: 'list'; data: WebhookEndpointObject[] }> {
    const rows = await this.endpoints.list(req.merchant);
    return { object: 'list', data: rows.map(toObject) };
  }

  @Post()
  async create(
    @Req() req: MerchantRequest,
    @Body(new ZodValidationPipe(CreateMerchantEndpointBodySchema))
    body: CreateMerchantEndpointBody,
  ): Promise<WebhookEndpointObject> {
    try {
      const { endpoint, secret } = await this.endpoints.register({
        merchantId: req.merchant.merchantId,
        mode: req.merchant.mode,
        url: body.url,
        eventTypes: body.event_types,
      });
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
      const { secret, secondaryExpiresAt } = await this.endpoints.rotateSecret(
        id,
        req.merchant,
      );
      const endpoint = await this.endpoints.find(id, req.merchant);
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
      const endpoint = await this.endpoints.disable(id, req.merchant);
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
