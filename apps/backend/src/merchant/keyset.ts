import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/**
 * A keyset-pagination predicate for `(createdAt desc, id desc)`: the rows
 * strictly after the cursor row in that order. The comparison runs entirely in
 * SQL against a subquery, so the cursor row's full-microsecond timestamp is
 * never materialized into a millisecond-truncating JavaScript Date and rows
 * sharing a millisecond are never skipped. The subquery is scoped, so a cursor
 * can only reference a row the caller is already allowed to read.
 */
export function keysetBefore(opts: {
  createdAt: PgColumn;
  id: PgColumn;
  table: PgTable;
  cursor: string;
  scope: SQL;
}): SQL {
  const { createdAt, id, table, cursor, scope } = opts;
  return sql`(${createdAt}, ${id}) < (select ${createdAt}, ${id} from ${table} where ${id} = ${cursor} and ${scope})`;
}
