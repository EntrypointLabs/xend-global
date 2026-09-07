import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { webhookEndpoints } from '../db/schema';
import { assertPublicHttpsUrl } from '../common/url-safety';
import { WebhookEndpointNotFoundError } from './webhook.errors';

export type EndpointRow = typeof webhookEndpoints.$inferSelect;

export interface EndpointScope {
  merchantId: string;
  /** When given, only an endpoint registered under this mode is visible. */
  mode?: 'test' | 'live';
}

export interface RegisterEndpointParams {
  merchantId: string;
  url: string;
  mode: 'test' | 'live';
  eventTypes?: string[] | null;
}

/**
 * Endpoint lifecycle shared by the internal ops surface and the merchant
 * self-serve API. The raw secret leaves this service exactly once, on
 * registration or rotation; every read hands back the row without it.
 */
@Injectable()
export class WebhookEndpointService {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  async register(
    params: RegisterEndpointParams,
  ): Promise<{ endpoint: EndpointRow; secret: string }> {
    const allowPrivate =
      this.config.get<boolean>('WEBHOOK_ALLOW_PRIVATE_URLS') ?? false;
    await assertPublicHttpsUrl(params.url, { allowPrivate });

    const secret = mintSecret();
    const [endpoint] = await this.db.client
      .insert(webhookEndpoints)
      .values({
        merchantId: params.merchantId,
        url: params.url,
        secretPrimary: secret,
        eventTypes: params.eventTypes ?? null,
        mode: params.mode,
      })
      .returning();
    return { endpoint, secret };
  }

  /** Enabled endpoints for the Merchant, newest first. */
  async list(scope: EndpointScope): Promise<EndpointRow[]> {
    return this.db.client
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.merchantId, scope.merchantId),
          eq(webhookEndpoints.enabled, true),
          ...(scope.mode ? [eq(webhookEndpoints.mode, scope.mode)] : []),
        ),
      )
      .orderBy(desc(webhookEndpoints.createdAt));
  }

  async find(id: string, scope?: EndpointScope): Promise<EndpointRow> {
    const [endpoint] = await this.db.client
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .limit(1);
    if (
      !endpoint ||
      (scope &&
        (endpoint.merchantId !== scope.merchantId ||
          (scope.mode && endpoint.mode !== scope.mode) ||
          !endpoint.enabled))
    ) {
      throw new WebhookEndpointNotFoundError(`endpoint ${id} not found`);
    }
    return endpoint;
  }

  /**
   * Moves the current primary to secondary so both sign during the grace
   * window, then installs the new primary. The old secret stops signing at
   * secondary_expires_at, so a merchant that never rotates their copy is not
   * left verifying against a retired key indefinitely.
   */
  async rotateSecret(
    id: string,
    scope?: EndpointScope,
  ): Promise<{ secret: string; secondaryExpiresAt: Date }> {
    const endpoint = await this.find(id, scope);
    const secret = mintSecret();
    const graceHours =
      this.config.get<number>('WEBHOOK_SECRET_ROTATION_GRACE_HOURS') ?? 24;
    const secondaryExpiresAt = new Date(
      Date.now() + graceHours * 60 * 60 * 1000,
    );
    await this.db.client
      .update(webhookEndpoints)
      .set({
        secretSecondary: endpoint.secretPrimary,
        secondaryExpiresAt,
        secretPrimary: secret,
        updatedAt: new Date(),
      })
      .where(eq(webhookEndpoints.id, id));
    return { secret, secondaryExpiresAt };
  }

  /**
   * Retires an endpoint. Its delivery history references it, so the row
   * stays and is disabled: the dispatcher skips it and every read hides it.
   */
  async disable(id: string, scope?: EndpointScope): Promise<EndpointRow> {
    const endpoint = await this.find(id, scope);
    const [updated] = await this.db.client
      .update(webhookEndpoints)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(webhookEndpoints.id, endpoint.id))
      .returning();
    return updated ?? { ...endpoint, enabled: false };
  }
}

function mintSecret(): string {
  return 'whsec_' + randomBytes(24).toString('base64url');
}
