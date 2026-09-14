import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { DbService } from '../db/db.service';
import {
  fiatQuotes,
  fiatOrders,
  fiatOrderEvents,
  squadsAccounts,
} from '../db/schema';
import type { FiatOrder, FiatQuote, StoredFiatOrder } from './fiat.types';
import { FiatError } from './fiat.errors';

export const FIAT_STORE = Symbol('FIAT_STORE');
export interface FiatStore {
  saveQuote(userId: string, quote: FiatQuote): Promise<void>;
  quote(userId: string, id: string): Promise<FiatQuote | null>;
  order(userId: string, id: string): Promise<StoredFiatOrder | null>;
  byKey(userId: string, key: string): Promise<StoredFiatOrder | null>;
  list(userId: string): Promise<FiatOrder[]>;
  create(row: StoredFiatOrder): Promise<boolean>;
  save(row: StoredFiatOrder): Promise<void>;
  vault(userId: string): Promise<string | null>;
  event(
    userId: string,
    orderId: string,
    key: string,
    hash: string,
    reduce: (order: FiatOrder) => FiatOrder,
  ): Promise<FiatOrder>;
}

@Injectable()
export class PgFiatStore implements FiatStore {
  constructor(private readonly db: DbService) {}
  async saveQuote(userId: string, quote: FiatQuote) {
    await this.db.client
      .insert(fiatQuotes)
      .values({ id: quote.id, userId, payload: quote });
  }
  async quote(userId: string, id: string) {
    const [row] = await this.db.client
      .select()
      .from(fiatQuotes)
      .where(and(eq(fiatQuotes.id, id), eq(fiatQuotes.userId, userId)));
    return row?.payload ?? null;
  }
  private unpack(row: typeof fiatOrders.$inferSelect): StoredFiatOrder {
    return {
      userId: row.userId,
      idempotencyKey: row.idempotencyKey,
      requestHash: row.requestHash,
      providerReference: row.providerReference,
      order: row.payload,
    };
  }
  async order(userId: string, id: string) {
    const [row] = await this.db.client
      .select()
      .from(fiatOrders)
      .where(and(eq(fiatOrders.id, id), eq(fiatOrders.userId, userId)));
    return row ? this.unpack(row) : null;
  }
  async byKey(userId: string, key: string) {
    const [row] = await this.db.client
      .select()
      .from(fiatOrders)
      .where(
        and(eq(fiatOrders.idempotencyKey, key), eq(fiatOrders.userId, userId)),
      );
    return row ? this.unpack(row) : null;
  }
  async list(userId: string) {
    return (
      await this.db.client
        .select()
        .from(fiatOrders)
        .where(eq(fiatOrders.userId, userId))
        .orderBy(desc(fiatOrders.createdAt))
        .limit(30)
    ).map((r) => r.payload);
  }
  async create(row: StoredFiatOrder) {
    const inserted = await this.db.client
      .insert(fiatOrders)
      .values({
        id: row.order.id,
        userId: row.userId,
        quoteId: row.order.quote.id,
        idempotencyKey: row.idempotencyKey,
        requestHash: row.requestHash,
        providerReference: row.providerReference,
        payload: row.order,
      })
      .onConflictDoNothing()
      .returning({ id: fiatOrders.id });
    return inserted.length > 0;
  }
  async save(row: StoredFiatOrder) {
    await this.db.client
      .update(fiatOrders)
      .set({ payload: row.order, providerReference: row.providerReference })
      .where(
        and(
          eq(fiatOrders.id, row.order.id),
          eq(fiatOrders.userId, row.userId),
          sql`${fiatOrders.payload}->>'status' = 'creating'`,
        ),
      );
  }
  async vault(userId: string) {
    const [row] = await this.db.client
      .select({ vault: squadsAccounts.vaultAddress })
      .from(squadsAccounts)
      .where(eq(squadsAccounts.userId, userId));
    return row?.vault ?? null;
  }
  async event(
    userId: string,
    orderId: string,
    key: string,
    hash: string,
    reduce: (order: FiatOrder) => FiatOrder,
  ) {
    return this.db.client.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(fiatOrders)
        .where(and(eq(fiatOrders.id, orderId), eq(fiatOrders.userId, userId)))
        .for('update');
      if (!row) throw new FiatError('ORDER_NOT_FOUND', 'Order not found.', 404);
      const [prior] = await tx
        .select()
        .from(fiatOrderEvents)
        .where(
          and(
            eq(fiatOrderEvents.orderId, orderId),
            eq(fiatOrderEvents.eventKey, key),
          ),
        );
      if (prior) {
        if (prior.requestHash !== hash)
          throw new FiatError(
            'IDEMPOTENCY_CONFLICT',
            'This request key was already used for a different update.',
            409,
          );
        return row.payload;
      }
      const order = reduce(row.payload);
      await tx
        .insert(fiatOrderEvents)
        .values({ id: createId(), orderId, eventKey: key, requestHash: hash });
      await tx
        .update(fiatOrders)
        .set({ payload: order })
        .where(eq(fiatOrders.id, orderId));
      return order;
    });
  }
}
