import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DbService } from '../src/db/db.service';
import { PostgresCapacityCounter } from '../src/counters/postgres-capacity-counter';

const url = process.env.PAYMENT_ATOMICITY_TEST_DATABASE_URL;
(url ? describe : describe.skip)('Payment transaction and lock safety', () => {
  let db: DbService;
  let counter: PostgresCapacityCounter;
  const prefix = `pr100-test:${randomUUID()}`;
  beforeAll(async () => {
    if (!['localhost', '127.0.0.1'].includes(new URL(url!).hostname))
      throw new Error('Tests require a local database');
    db = new DbService(
      new ConfigService({
        DATABASE_URL: url,
        DB_POOL_MAX: 2,
        DB_CONNECTION_TIMEOUT_MS: 1000,
      }),
    );
    await db.onModuleInit();
    counter = new PostgresCapacityCounter(db);
  });
  afterAll(async () => {
    await db.client.execute(
      sql`DELETE FROM capacity_counters WHERE key LIKE ${prefix + '%'}`,
    );
    await db.onModuleDestroy();
  });

  it('rolls back both capacity windows when a later authorization write fails', async () => {
    const day = `${prefix}:rollback-day`;
    const month = `${prefix}:rollback-month`;
    await expect(
      db.withTransaction(async () => {
        expect((await counter.reserve(day, '400', '1000', 60)).allowed).toBe(
          true,
        );
        expect((await counter.reserve(month, '400', '1000', 60)).allowed).toBe(
          true,
        );
        // A real SQL failure aborts the transaction just like a rejected attempt insert.
        await db.client.execute(sql`SELECT 1 / 0`);
      }),
    ).rejects.toThrow();
    expect(await counter.peek(day)).toEqual({ count: 0, totalRaw: '0' });
    expect(await counter.peek(month)).toEqual({ count: 0, totalRaw: '0' });
  });

  it('serializes concurrent capacity reservations without exceeding the cap', async () => {
    const key = `${prefix}:cap`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.withTransaction(() => counter.reserve(key, '400', '1000', 60)),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(2);
    expect(await counter.peek(key)).toEqual({ count: 2, totalRaw: '800' });
  });

  it('allows a lock holder to query when retries occupy every pool connection', async () => {
    const key = `${prefix}:lock`;
    let running = 0;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.withAdvisoryLock(key, async () => {
          running++;
          expect(running).toBe(1);
          await db.client.execute(sql`SELECT pg_sleep(0.02)`);
          const result = await counter.reserve(key, '1', '100', 60);
          running--;
          return result;
        }),
      ),
    );
    expect(results.every((r) => r.allowed)).toBe(true);
    expect(await counter.peek(key)).toEqual({ count: 8, totalRaw: '8' });
  });

  it('releases the lock and restores pooled access after an exception', async () => {
    const key = `${prefix}:failed-lock`;
    await expect(
      db.withAdvisoryLock(key, () => Promise.reject(new Error('failure'))),
    ).rejects.toThrow('failure');
    await expect(
      db.withAdvisoryLock(key, () => counter.peek(key)),
    ).resolves.toEqual({ count: 0, totalRaw: '0' });
  });
});
