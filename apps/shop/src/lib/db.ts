import "server-only";
import postgres from "postgres";
import { seedRows } from "./catalog";

declare global {
  var __shopSql: postgres.Sql | undefined;
  var __shopSchema: Promise<void> | undefined;
}

function client(): postgres.Sql {
  if (!globalThis.__shopSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__shopSql = postgres(url, {
      max: 3,
      idle_timeout: 20,
      // Pooled serverless endpoints (Neon's -pooler host) run in transaction mode, which cannot hold prepared statements.
      prepare: false,
    });
  }
  return globalThis.__shopSql;
}

async function migrate(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS inventory (
      sku text PRIMARY KEY,
      product_id text NOT NULL,
      size text,
      stock integer NOT NULL CHECK (stock >= 0)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id text PRIMARY KEY,
      number text NOT NULL UNIQUE,
      email text NOT NULL,
      name text NOT NULL,
      items jsonb NOT NULL,
      total_cents integer NOT NULL,
      status text NOT NULL DEFAULT 'awaiting_payment',
      intent_id text UNIQUE,
      payment_status text,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      paid_at timestamptz,
      last_checked_at timestamptz
    )`;
  await sql`CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (lower(email), created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS orders_open_idx ON orders (created_at) WHERE status = 'awaiting_payment'`;
  await sql`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id text PRIMARY KEY,
      type text NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    )`;
  const rows = seedRows().map((r) => ({
    sku: r.sku,
    product_id: r.productId,
    size: r.size,
    stock: r.stock,
  }));
  await sql`INSERT INTO inventory ${sql(rows, "sku", "product_id", "size", "stock")} ON CONFLICT (sku) DO NOTHING`;
}

export async function db(): Promise<postgres.Sql> {
  const sql = client();
  globalThis.__shopSchema ??= migrate(sql).catch((err) => {
    globalThis.__shopSchema = undefined;
    throw err;
  });
  await globalThis.__shopSchema;
  return sql;
}
