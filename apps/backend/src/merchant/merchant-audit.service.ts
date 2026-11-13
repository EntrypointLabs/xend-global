import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DbService, type DbExecutor } from '../db/db.service';
import { merchantAuditLog } from '../db/schema';
import { keysetBefore } from './keyset';

export type MerchantAuditAction =
  | 'profile.update'
  | 'destination.provision'
  | 'api_key.issue'
  | 'api_key.revoke'
  | 'api_key.rotate'
  | 'webhook.create'
  | 'webhook.rotate_secret'
  | 'webhook.delete'
  | 'kyb.submit';

export interface MerchantAuditEntry {
  id: string;
  action: string;
  /** A safe label for who made the change, never the raw provider identifier:
   * "API key" for the integration-key surface, "Owner" for the portal. */
  actor: string;
  target: string | null;
  metadata: Record<string, string> | null;
  at: string;
}

/**
 * Map the stored actor to a label safe to show the owner. The portal records
 * the owner's provider id, which must not leak into the feed; the API-key
 * surface records `api_key:<id>`, and distinguishing the two is the point of
 * the trail, so an integration-key change never reads as an owner action.
 */
function actorLabel(actor: string): string {
  return actor.startsWith('api_key:') ? 'API key' : 'Owner';
}

export interface MerchantAuditPage {
  entries: MerchantAuditEntry[];
  nextCursor: string | null;
}

/**
 * The owner-visible trail of sensitive self-serve writes. Every portal write
 * that changes money-adjacent configuration records one entry here, and the
 * owner reads their own trail back. Append-only: there is no update or delete.
 */
@Injectable()
export class MerchantAuditService {
  constructor(private readonly db: DbService) {}

  async record(
    input: {
      merchantId: string;
      actor: string;
      action: MerchantAuditAction;
      target?: string | null;
      metadata?: Record<string, string> | null;
    },
    /** Pass a transaction handle to record atomically with the caller's write. */
    db: DbExecutor = this.db.client,
  ): Promise<void> {
    await db.insert(merchantAuditLog).values({
      merchantId: input.merchantId,
      actor: input.actor,
      action: input.action,
      target: input.target ?? null,
      metadata: input.metadata ?? null,
    });
  }

  /**
   * A page of the Merchant's trail, newest first. The cursor is the last id of
   * the previous page; rows are ordered by (at desc, id desc) so the keyset
   * stays stable even when several entries share a timestamp.
   */
  async list(
    merchantId: string,
    options: { limit: number; cursor?: string | null },
  ): Promise<MerchantAuditPage> {
    const limit = Math.min(Math.max(options.limit, 1), 100);
    const rows = await this.db.client
      .select()
      .from(merchantAuditLog)
      .where(
        and(
          eq(merchantAuditLog.merchantId, merchantId),
          ...(options.cursor
            ? [
                keysetBefore({
                  createdAt: merchantAuditLog.at,
                  id: merchantAuditLog.id,
                  table: merchantAuditLog,
                  cursor: options.cursor,
                  scope: eq(merchantAuditLog.merchantId, merchantId),
                }),
              ]
            : []),
        ),
      )
      .orderBy(desc(merchantAuditLog.at), desc(merchantAuditLog.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      entries: page.map((row) => ({
        id: row.id,
        action: row.action,
        actor: actorLabel(row.actor),
        target: row.target,
        metadata: row.metadata,
        at: row.at.toISOString(),
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }
}
