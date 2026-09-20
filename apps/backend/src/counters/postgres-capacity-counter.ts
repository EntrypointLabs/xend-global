import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import type {
  CounterSnapshot,
  ReservationResult,
  ReservingRateCounter,
} from './rate-counter.interface';

/** Capacity lives in the same transaction as the Payment it authorizes. */
@Injectable()
export class PostgresCapacityCounter implements ReservingRateCounter {
  constructor(private readonly db: DbService) {}

  async reserve(
    key: string,
    amountRaw: string,
    capRaw: string,
    ttlSeconds: number,
  ): Promise<ReservationResult> {
    const result = await this.db.client.execute(sql`
      INSERT INTO capacity_counters (key, count, total_raw, expires_at)
      SELECT ${key}, 1, ${amountRaw}::numeric, NOW() + ${ttlSeconds} * INTERVAL '1 second'
      WHERE ${amountRaw}::numeric <= ${capRaw}::numeric
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN capacity_counters.expires_at <= NOW() THEN 1 ELSE capacity_counters.count + 1 END,
        total_raw = CASE WHEN capacity_counters.expires_at <= NOW() THEN ${amountRaw}::numeric ELSE capacity_counters.total_raw + ${amountRaw}::numeric END,
        expires_at = CASE WHEN capacity_counters.expires_at <= NOW() THEN EXCLUDED.expires_at ELSE capacity_counters.expires_at END
      WHERE (CASE WHEN capacity_counters.expires_at <= NOW() THEN 0 ELSE capacity_counters.total_raw END) + ${amountRaw}::numeric <= ${capRaw}::numeric
      RETURNING count, total_raw::text AS "totalRaw"
    `);
    const row = result.rows[0] as unknown as CounterSnapshot | undefined;
    return { allowed: !!row, snapshot: row ?? (await this.peek(key)) };
  }

  async increment(
    key: string,
    amountRaw: string,
    ttlSeconds: number,
  ): Promise<CounterSnapshot> {
    return (await this.reserve(key, amountRaw, '9'.repeat(78), ttlSeconds))
      .snapshot;
  }

  async release(key: string, amountRaw: string): Promise<void> {
    await this.db.client.execute(
      sql`UPDATE capacity_counters SET count = GREATEST(0, count - 1), total_raw = GREATEST(0, total_raw - ${amountRaw}::numeric) WHERE key = ${key} AND expires_at > NOW()`,
    );
  }

  async peek(key: string): Promise<CounterSnapshot> {
    const result = await this.db.client.execute(
      sql`SELECT count, total_raw::text AS "totalRaw" FROM capacity_counters WHERE key = ${key} AND expires_at > NOW()`,
    );
    return (
      (result.rows[0] as unknown as CounterSnapshot | undefined) ?? {
        count: 0,
        totalRaw: '0',
      }
    );
  }

  async clear(key: string): Promise<void> {
    await this.db.client.execute(
      sql`DELETE FROM capacity_counters WHERE key = ${key}`,
    );
  }
}
