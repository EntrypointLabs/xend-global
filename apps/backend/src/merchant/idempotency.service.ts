import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { idempotencyKeys } from '../db/schema';
import { IdempotencyKeyReuseError } from './merchant.errors';

export interface IdempotentResult<T> {
  status: number;
  body: T;
}

/** Postgres unique-violation SQLSTATE, surfaced by node-postgres. */
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/**
 * The general merchant-write idempotency layer (Stripe semantics). With no
 * key, the write runs unguarded. With a key, a replay of the same request
 * body in the same execution cluster returns the byte-identical stored
 * response and never re-runs the write; a reuse of the same key with a
 * different body is a 409. The
 * per-intent unique index from Phase 2 stays as the DB backstop.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly db: DbService) {}

  async run<T>(
    merchantId: string,
    idempotencyKey: string | undefined,
    requestHash: string,
    produce: () => Promise<IdempotentResult<T>>,
    executionCluster = 'legacy',
  ): Promise<IdempotentResult<T>> {
    if (!idempotencyKey) return produce();

    const existing = await this.find(
      merchantId,
      executionCluster,
      idempotencyKey,
    );
    if (existing) {
      return this.assertMatchAndReturn<T>(existing, requestHash);
    }

    const result = await produce();
    try {
      await this.db.client.insert(idempotencyKeys).values({
        merchantId,
        executionCluster,
        idempotencyKey,
        requestHash,
        responseStatus: result.status,
        responseBody: JSON.stringify(result.body),
      });
      return result;
    } catch (err) {
      // Lost the race on the (merchant, cluster, key) unique index: return the
      // stored winner so concurrent replays converge on one response.
      if (pgErrorCode(err) === '23505') {
        const winner = await this.find(
          merchantId,
          executionCluster,
          idempotencyKey,
        );
        if (winner) return this.assertMatchAndReturn<T>(winner, requestHash);
      }
      throw err;
    }
  }

  private assertMatchAndReturn<T>(
    row: { requestHash: string; responseStatus: number; responseBody: string },
    requestHash: string,
  ): IdempotentResult<T> {
    if (row.requestHash !== requestHash) {
      throw new IdempotencyKeyReuseError(
        'idempotency key reused with a different request body',
      );
    }
    return {
      status: row.responseStatus,
      body: JSON.parse(row.responseBody) as T,
    };
  }

  private async find(
    merchantId: string,
    executionCluster: string,
    idempotencyKey: string,
  ) {
    const [row] = await this.db.client
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.merchantId, merchantId),
          eq(idempotencyKeys.executionCluster, executionCluster),
          eq(idempotencyKeys.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row;
  }
}
