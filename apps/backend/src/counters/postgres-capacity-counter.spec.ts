import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbService } from '../db/db.service';
import { PostgresCapacityCounter } from './postgres-capacity-counter';

describe('PostgresCapacityCounter', () => {
  it('purges expired windows with an indexable expires_at predicate', async () => {
    let statement: SQL | undefined;
    const execute = jest.fn((query: SQL) => {
      statement = query;
      return Promise.resolve({ rows: [], rowCount: 2 });
    });
    const db = { client: { execute } } as unknown as DbService;
    const counter = new PostgresCapacityCounter(db);

    await counter.purgeExpired();

    expect(statement).toBeDefined();
    const query = new PgDialect().sqlToQuery(statement as SQL);
    expect(query.sql).toBe(
      'DELETE FROM capacity_counters WHERE expires_at <= NOW()',
    );
  });
});
