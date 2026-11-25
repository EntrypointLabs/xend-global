import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';

export const VOLUME_PRODUCTS = ['send', 'pay', 'swap', 'ramp', 'earn'] as const;
export type VolumeProduct = (typeof VOLUME_PRODUCTS)[number];

export const TREND_DAYS = 30;

export interface VolumeFigure {
  /** US cents, so totals are summed as integers and never as floats. */
  totalCents: bigint;
  recentCents: bigint;
  count: number;
  recentCount: number;
}

export interface ConsoleMetrics {
  asOf: Date;
  /** Everything Consumers did through Prydd: the sum of `products`. */
  volume: VolumeFigure;
  products: Record<VolumeProduct, VolumeFigure>;
  /** Money that arrived from outside Prydd. Never part of `volume`. */
  deposits: VolumeFigure;
  /** One entry per UTC day, oldest first, always TREND_DAYS long. */
  daily: { day: string; cents: bigint }[];
  users: {
    total: number;
    recent: number;
    accounts: number;
    /** Consumers who moved money themselves inside the trend window. */
    active: number;
    merchants: number;
  };
}

interface VolumeRow extends Record<string, unknown> {
  product: VolumeProduct | 'deposit';
  day: string;
  cents: string;
  n: number;
}

interface CountsRow extends Record<string, unknown> {
  users: number;
  recent_users: number;
  accounts: number;
  merchants: number;
  active: number;
}

/**
 * One row per thing that moved money, labelled with the product behind it.
 *
 * The chain indexer records a swap, an Earn deposit and a naira bank send as
 * plain transfers, so each is claimed by the table that knows what it was
 * before the remainder is called a send. Without that a swap would count
 * twice: once as itself and once as a send to an address nobody knows.
 *
 * Timestamps are compared as UTC wall-clock values: most tables store them
 * without a zone, and the fiat tables, which do not, are converted to match.
 */
const EVENTS = sql`
  WITH ramp AS (
    SELECT
      user_id,
      created_at AT TIME ZONE 'UTC' AS at,
      payload->>'id' AS id,
      payload->>'status' AS status,
      payload->'route'->>'direction' AS direction,
      payload->'instructions'->>'depositAddress' AS deposit_address,
      payload->>'settlementSignature' AS settlement_signature,
      payload->>'refundSignature' AS refund_signature,
      CASE WHEN payload->'route'->>'direction' = 'receive'
        THEN payload->'quote'->'credit'
        ELSE payload->'quote'->'debit'
      END AS usdc_leg
    FROM fiat_orders
    WHERE COALESCE((payload->>'simulation')::boolean, false) = false
  ),
  moves AS (
    SELECT
      t.id, t.direction, t.signature, t.from_address, t.to_address,
      sa.user_id,
      COALESCE(t.confirmed_at, t.created_at) AS at,
      COALESCE(t.usd_value, 0) AS usd,
      EXISTS (SELECT 1 FROM swaps s WHERE s.signature = t.signature) AS is_swap
    FROM transfers t
    JOIN smart_accounts sa ON sa.id = t.smart_account_id
    WHERE t.status = 'CONFIRMED'
      AND t.kind = 'transfer'
      AND NOT EXISTS (
        SELECT 1 FROM earn_operations e WHERE e.signature = t.signature
      )
  ),
  events AS (
    SELECT 'send' AS product, user_id, at, usd, id AS ref
    FROM moves m
    WHERE direction = 'SEND' AND NOT is_swap
      AND NOT EXISTS (
        SELECT 1 FROM ramp r
        WHERE r.direction = 'send' AND r.deposit_address = m.to_address
      )
    UNION ALL
    SELECT 'swap', user_id, at, usd, signature
    FROM moves
    WHERE direction = 'SEND' AND is_swap
    UNION ALL
    SELECT 'deposit', user_id, at, usd, id
    FROM moves m
    WHERE direction = 'RECEIVE' AND NOT is_swap
      AND NOT EXISTS (
        SELECT 1 FROM ramp r
        WHERE m.signature IN (r.settlement_signature, r.refund_signature)
      )
      AND NOT EXISTS (
        SELECT 1 FROM squads_accounts a WHERE a.vault_address = m.from_address
      )
      AND NOT EXISTS (
        SELECT 1 FROM smart_accounts w WHERE w.wallet_address = m.from_address
      )
    UNION ALL
    SELECT 'pay', p.consumer_id, p.settled_at,
      p.usdc_settlement_raw::numeric / 1000000, p.id
    FROM payments p
    JOIN payment_intents i ON i.id = p.intent_id
    WHERE p.settled_at IS NOT NULL
      AND p.refund_of_payment_id IS NULL
      AND i.mode = 'live'
      AND i.execution_cluster IS DISTINCT FROM 'devnet'
    UNION ALL
    SELECT 'ramp', user_id, at,
      (usdc_leg->>'amountMinor')::numeric
        / power(10::numeric, (usdc_leg->>'decimals')::int),
      id
    FROM ramp
    WHERE status = 'completed' AND usdc_leg->>'currency' = 'USDC'
    UNION ALL
    SELECT 'earn', user_id, COALESCE(confirmed_at, created_at),
      abs(cash_delta_raw::numeric) / 1000000, signature
    FROM earn_operations
    WHERE status = 'confirmed' AND action = 'deposit'
      AND cash_delta_raw IS NOT NULL
  )
`;

function emptyFigure(): VolumeFigure {
  return { totalCents: 0n, recentCents: 0n, count: 0, recentCount: 0 };
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The UTC days of the trend window, oldest first, ending on `now`'s day. */
export function trendDays(now: Date): string[] {
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Array.from({ length: TREND_DAYS }, (_, i) =>
    utcDay(new Date(end - (TREND_DAYS - 1 - i) * 86_400_000)),
  );
}

/** Aggregate figures for the console's Metrics page. Read-only. */
@Injectable()
export class ConsoleMetricsService {
  constructor(private readonly db: DbService) {}

  async load(now: Date = new Date()): Promise<ConsoleMetrics> {
    const days = trendDays(now);
    const since = days[0];

    const [volume, counts] = await Promise.all([
      this.db.client.execute<VolumeRow>(sql`
        ${EVENTS}
        SELECT
          product,
          to_char(at, 'YYYY-MM-DD') AS day,
          round(sum(usd) * 100)::bigint::text AS cents,
          count(DISTINCT ref)::int AS n
        FROM events
        GROUP BY 1, 2
      `),
      this.db.client.execute<CountsRow>(sql`
        ${EVENTS}
        SELECT
          (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS users,
          (SELECT count(*)::int FROM users
            WHERE deleted_at IS NULL AND created_at >= ${since}::date
          ) AS recent_users,
          (SELECT count(*)::int FROM squads_accounts) AS accounts,
          (SELECT count(*)::int FROM merchants WHERE status = 'active')
            AS merchants,
          (SELECT count(DISTINCT user_id)::int FROM events
            WHERE product <> 'deposit' AND at >= ${since}::date
          ) AS active
      `),
    ]);

    const products = Object.fromEntries(
      VOLUME_PRODUCTS.map((p) => [p, emptyFigure()]),
    ) as Record<VolumeProduct, VolumeFigure>;
    const deposits = emptyFigure();
    const total = emptyFigure();
    const byDay = new Map(days.map((day) => [day, 0n]));

    for (const row of volume.rows) {
      const cents = BigInt(row.cents);
      const recent = row.day >= since;
      const targets =
        row.product === 'deposit' ? [deposits] : [products[row.product], total];
      for (const figure of targets) {
        figure.totalCents += cents;
        figure.count += row.n;
        if (recent) {
          figure.recentCents += cents;
          figure.recentCount += row.n;
        }
      }
      if (row.product !== 'deposit' && byDay.has(row.day)) {
        byDay.set(row.day, (byDay.get(row.day) ?? 0n) + cents);
      }
    }

    const c = counts.rows[0];
    return {
      asOf: now,
      volume: total,
      products,
      deposits,
      daily: days.map((day) => ({ day, cents: byDay.get(day) ?? 0n })),
      users: {
        total: c.users,
        recent: c.recent_users,
        accounts: c.accounts,
        active: c.active,
        merchants: c.merchants,
      },
    };
  }
}
