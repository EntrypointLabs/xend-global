import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DbService, type DbExecutor } from '../db/db.service';
import { webhookEndpoints } from '../db/schema';
import { assertPublicHttpsUrl } from '../common/url-safety';
import {
  WebhookEndpointNotFoundError,
  WebhookSecretRotationConflictError,
} from './webhook.errors';

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

  /**
   * SSRF validation, including the DNS resolve. Exposed so a caller wrapping
   * the insert in a transaction can run this BEFORE opening it: the resolve is
   * unbounded, and holding a pooled connection open across it would let one
   * merchant's slow host starve the pool.
   */
  async assertUrlSafe(url: string): Promise<void> {
    const allowPrivate =
      this.config.get<boolean>('WEBHOOK_ALLOW_PRIVATE_URLS') ?? false;
    await assertPublicHttpsUrl(url, { allowPrivate });
  }

  async register(
    params: RegisterEndpointParams,
    db: DbExecutor = this.db.client,
    options: { skipUrlCheck?: boolean } = {},
  ): Promise<{ endpoint: EndpointRow; secret: string }> {
    if (!options.skipUrlCheck) await this.assertUrlSafe(params.url);

    const secret = mintSecret();
    const [endpoint] = await db
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

  async find(
    id: string,
    scope?: EndpointScope,
    db: DbExecutor = this.db.client,
  ): Promise<EndpointRow> {
    const [endpoint] = await db
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
   *
   * The update is conditional on the primary secret that was read, so two
   * concurrent rotations cannot both derive a successor from the same primary
   * and have the loser overwrite the winner's new primary while carrying the
   * wrong secondary. The second write matches no row and is reported as a
   * conflict for the caller to retry against the now-current primary.
   */
  async rotateSecret(
    id: string,
    scope?: EndpointScope,
    db: DbExecutor = this.db.client,
  ): Promise<{ secret: string; secondaryExpiresAt: Date }> {
    const endpoint = await this.find(id, scope, db);
    const secret = mintSecret();
    const graceHours =
      this.config.get<number>('WEBHOOK_SECRET_ROTATION_GRACE_HOURS') ?? 24;
    const secondaryExpiresAt = new Date(
      Date.now() + graceHours * 60 * 60 * 1000,
    );
    const [updated] = await db
      .update(webhookEndpoints)
      .set({
        secretSecondary: endpoint.secretPrimary,
        secondaryExpiresAt,
        secretPrimary: secret,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.secretPrimary, endpoint.secretPrimary),
          // Stay conditional on the endpoint still being live: a delete that
          // commits between find() and this update would otherwise mint a new
          // one-time secret and audit a rotation for an endpoint that can no
          // longer receive deliveries.
          eq(webhookEndpoints.enabled, true),
        ),
      )
      .returning({ id: webhookEndpoints.id });
    if (!updated)
      throw new WebhookSecretRotationConflictError(
        `endpoint ${id} secret rotated concurrently; retry`,
      );
    return { secret, secondaryExpiresAt };
  }

  /**
   * Retires an endpoint. Its delivery history references it, so the row stays
   * and is disabled: the dispatcher skips it and every read hides it. The
   * update is conditional on the row still being enabled and reports whether
   * this call performed the transition, so two concurrent deletes do not both
   * record a delete in the audit trail.
   */
  async disable(
    id: string,
    scope?: EndpointScope,
    db: DbExecutor = this.db.client,
  ): Promise<{ endpoint: EndpointRow; claimed: boolean }> {
    const endpoint = await this.find(id, scope, db);
    const [updated] = await db
      .update(webhookEndpoints)
      .set({ enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(webhookEndpoints.id, endpoint.id),
          eq(webhookEndpoints.enabled, true),
        ),
      )
      .returning();
    return {
      endpoint: updated ?? { ...endpoint, enabled: false },
      claimed: Boolean(updated),
    };
  }
}

function mintSecret(): string {
  return 'whsec_' + randomBytes(24).toString('base64url');
}
