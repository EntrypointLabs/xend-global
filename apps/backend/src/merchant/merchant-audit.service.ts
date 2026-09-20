import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { merchantAuditLog } from '../db/schema';

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
  target: string | null;
  metadata: Record<string, string> | null;
  at: string;
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

  async record(input: {
    merchantId: string;
    actor: string;
    action: MerchantAuditAction;
    target?: string | null;
    metadata?: Record<string, string> | null;
  }): Promise<void> {
    await this.db.client.insert(merchantAuditLog).values({
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
    const after = options.cursor
      ? await this.cursorRow(merchantId, options.cursor)
      : null;
    const rows = await this.db.client
      .select()
      .from(merchantAuditLog)
      .where(
        and(
          eq(merchantAuditLog.merchantId, merchantId),
          ...(after
            ? [
                or(
                  lt(merchantAuditLog.at, after.at),
                  and(
                    eq(merchantAuditLog.at, after.at),
                    lt(merchantAuditLog.id, after.id),
                  ),
                ),
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
        target: row.target,
        metadata: row.metadata,
        at: row.at.toISOString(),
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  private async cursorRow(merchantId: string, cursor: string) {
    const [row] = await this.db.client
      .select({ id: merchantAuditLog.id, at: merchantAuditLog.at })
      .from(merchantAuditLog)
      .where(
        and(
          eq(merchantAuditLog.id, cursor),
          eq(merchantAuditLog.merchantId, merchantId),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}
