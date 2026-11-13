import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { webhookDeliveries } from '../db/schema';
import { keysetBefore } from './keyset';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UnsafeUrlError } from '../common/url-safety';
import {
  WebhookEndpointNotFoundError,
  WebhookSecretRotationConflictError,
} from '../webhook/webhook.errors';
import { WebhookEndpointService } from '../webhook/webhook-endpoint.service';
import { MerchantAuditService } from './merchant-audit.service';
import { MerchantOwnerService } from './merchant-owner.service';
import { toWebhookEndpointView } from './merchant-portal.view';

const CreateEndpoint = z.object({
  url: z.string().trim().url().max(2048),
  mode: z.enum(['test', 'live']),
  eventTypes: z.array(z.string().trim().min(1).max(64)).max(50).nullish(),
});

/**
 * Owner-authenticated webhook management for the portal. It shares the same
 * WebhookEndpointService as the API-key surface, so SSRF validation, the
 * secret lifecycle and the soft-disable semantics are identical; only the
 * authentication differs. A signing secret leaves the server exactly once,
 * on creation or rotation, and never appears on a read.
 */
@Controller('merchant-portal/webhooks')
export class MerchantPortalWebhooksController {
  constructor(
    private readonly db: DbService,
    private readonly owner: MerchantOwnerService,
    private readonly endpoints: WebhookEndpointService,
    private readonly audit: MerchantAuditService,
  ) {}

  @Get()
  async list(@Headers('authorization') authorization?: string) {
    const merchant = await this.owner.owned(authorization);
    const rows = await this.endpoints.list({ merchantId: merchant.id });
    return { endpoints: rows.map(toWebhookEndpointView) };
  }

  @Post()
  async create(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodValidationPipe(CreateEndpoint))
    body: z.infer<typeof CreateEndpoint>,
  ) {
    const merchant = await this.owner.owned(authorization);
    try {
      // Resolve/validate the URL before opening the transaction: the DNS lookup
      // is unbounded and must not hold a pooled connection open.
      await this.endpoints.assertUrlSafe(body.url);
      // Create and audit commit together: a failed audit write must not leave a
      // live endpoint receiving deliveries signed with a secret the merchant
      // never obtained (reads omit it, so a retry would only orphan another).
      const { endpoint, secret } = await this.db.client.transaction(
        async (tx) => {
          const created = await this.endpoints.register(
            {
              merchantId: merchant.id,
              mode: body.mode,
              url: body.url,
              eventTypes: body.eventTypes ?? null,
            },
            tx,
            { skipUrlCheck: true },
          );
          await this.audit.record(
            {
              merchantId: merchant.id,
              actor: merchant.ownerProviderId ?? 'unknown',
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
      return { ...toWebhookEndpointView(endpoint), secret };
    } catch (error) {
      this.mapServiceError(error);
    }
  }

  @Post(':id/rotate_secret')
  async rotate(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    const merchant = await this.owner.owned(authorization);
    try {
      const { endpoint, secret, secondaryExpiresAt } =
        await this.db.client.transaction(async (tx) => {
          const rotated = await this.endpoints.rotateSecret(
            id,
            { merchantId: merchant.id },
            tx,
          );
          const found = await this.endpoints.find(
            id,
            { merchantId: merchant.id },
            tx,
          );
          await this.audit.record(
            {
              merchantId: merchant.id,
              actor: merchant.ownerProviderId ?? 'unknown',
              action: 'webhook.rotate_secret',
              target: id,
              metadata: { url: found.url },
            },
            tx,
          );
          return { endpoint: found, ...rotated };
        });
      return {
        ...toWebhookEndpointView(endpoint),
        secret,
        previousSecretExpiresAt: secondaryExpiresAt.toISOString(),
      };
    } catch (error) {
      this.mapServiceError(error);
    }
  }

  @Post(':id/delete')
  async remove(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    const merchant = await this.owner.owned(authorization);
    try {
      const endpoint = await this.db.client.transaction(async (tx) => {
        const disabled = await this.endpoints.disable(
          id,
          { merchantId: merchant.id },
          tx,
        );
        // Only the request that actually disabled the endpoint records the
        // audit entry, so a concurrent double-delete does not log twice.
        if (disabled.claimed)
          await this.audit.record(
            {
              merchantId: merchant.id,
              actor: merchant.ownerProviderId ?? 'unknown',
              action: 'webhook.delete',
              target: id,
              metadata: { url: disabled.endpoint.url },
            },
            tx,
          );
        return disabled.endpoint;
      });
      return { id: endpoint.id, deleted: true };
    } catch (error) {
      this.mapServiceError(error);
    }
  }

  /**
   * Delivery diagnostics for one endpoint. Ownership is proven through find()
   * before any delivery row is read, so an owner can only ever see their own
   * endpoint's history. Newest first, keyset-paginated on (createdAt desc, id
   * desc) with a cursor, so an endpoint with more than a page of attempts still
   * exposes its older failures rather than truncating them silently.
   */
  @Get(':id/deliveries')
  async deliveries(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const merchant = await this.owner.owned(authorization);
    try {
      await this.endpoints.find(id, { merchantId: merchant.id });
    } catch (error) {
      this.mapServiceError(error);
    }
    const take = clampLimit(limit, 20, 100);
    const rows = await this.db.client
      .select({
        id: webhookDeliveries.id,
        eventId: webhookDeliveries.eventId,
        eventType: webhookDeliveries.eventType,
        status: webhookDeliveries.status,
        attemptNo: webhookDeliveries.attemptNo,
        responseStatus: webhookDeliveries.responseStatus,
        durationMs: webhookDeliveries.durationMs,
        nextRetryAt: webhookDeliveries.nextRetryAt,
        createdAt: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.endpointId, id),
          ...(cursor
            ? [
                keysetBefore({
                  createdAt: webhookDeliveries.createdAt,
                  id: webhookDeliveries.id,
                  table: webhookDeliveries,
                  cursor,
                  scope: eq(webhookDeliveries.endpointId, id),
                }),
              ]
            : []),
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(take + 1);
    const page = rows.slice(0, take);
    return {
      deliveries: page.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        eventType: row.eventType,
        status: row.status,
        attemptNo: row.attemptNo,
        responseStatus: row.responseStatus,
        durationMs: row.durationMs,
        nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  private mapServiceError(error: unknown): never {
    if (error instanceof UnsafeUrlError)
      throw new HttpException(
        { statusCode: 422, message: error.message, code: error.code },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    if (error instanceof WebhookEndpointNotFoundError)
      throw new NotFoundException('Webhook endpoint not found');
    if (error instanceof WebhookSecretRotationConflictError)
      throw new ConflictException(
        'This endpoint was rotated in another session. Reload and try again.',
      );
    throw error as Error;
  }
}

function clampLimit(raw: string | undefined, fallback: number, max: number) {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}
