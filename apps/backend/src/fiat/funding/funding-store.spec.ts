/** Opt-in PostgreSQL tests; only create/drop a randomly named isolated schema. */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PgFundingStore, type ReserveFundingRequest } from './funding-store';

const describePg = process.env.FIAT_PG_TEST_DATABASE_URL
  ? describe
  : describe.skip;

describePg('durable unified funding reservations', () => {
  const namespace = `funding_test_${randomBytes(6).toString('hex')}`;
  let pool: Pool;
  let store: PgFundingStore;
  const request = (
    overrides: Partial<ReserveFundingRequest> = {},
  ): ReserveFundingRequest => ({
    ownerId: 'alice',
    idempotencyKey: 'send-key-0001',
    destinationCurrency: 'NGN',
    recipientMinor: '40000000',
    payoutFeeMinor: '0',
    quote: null,
    executionBinding: {
      payoutDestination: 'validated-beneficiary',
      payoutProvider: 'nomba',
    },
    ...overrides,
  });
  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.FIAT_PG_TEST_DATABASE_URL,
      max: 6,
    });
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    const sql = readFileSync(join(__dirname, 'funding-store.sql'), 'utf8');
    await pool.query(sql.replaceAll('__SCHEMA__', `"${namespace}"`));
    store = new PgFundingStore(pool, namespace);
  });
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE "${namespace}".funding_journal, "${namespace}".funding_intents, "${namespace}".funding_holdings`,
    );
    await pool.query(
      `INSERT INTO "${namespace}".funding_holdings
       (owner_id, ngn_settled, usdc_settled, reconciliation_reference, reconciled_at)
       VALUES ('alice',50000000,100000000,'reconciled-ledger-1',clock_timestamp()),
              ('bob',1000000,1000000,'reconciled-ledger-2',clock_timestamp())`,
    );
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await pool.end();
    }
  });

  async function reservations() {
    const result = await pool.query<{
      ngn_reserved: string;
      usdc_reserved: string;
    }>(
      `SELECT ngn_reserved, usdc_reserved FROM "${namespace}".funding_holdings WHERE owner_id = 'alice'`,
    );
    return result.rows[0];
  }

  it('serializes duplicate requests, reserves once, survives store restart and scopes ownership', async () => {
    const input = request();
    const intents = await Promise.all(
      Array.from({ length: 5 }, () => store.reserve(input)),
    );
    expect(new Set(intents.map((intent) => intent.id)).size).toBe(1);
    expect(await reservations()).toEqual({
      ngn_reserved: '40000000',
      usdc_reserved: '0',
    });
    const restarted = new PgFundingStore(pool, namespace);
    expect(await restarted.get('alice', intents[0].id)).toEqual(intents[0]);
    expect(await restarted.get('bob', intents[0].id)).toBeNull();
    expect(await restarted.reserve(input)).toEqual(intents[0]);
  });

  it('rejects changed recipient or amount under an existing key', async () => {
    await store.reserve(request());
    await expect(
      store.reserve(request({ recipientMinor: '20000000' })),
    ).rejects.toThrow('FUNDING_IDEMPOTENCY_CONFLICT');
    await expect(
      store.reserve(
        request({
          executionBinding: {
            payoutDestination: 'another-beneficiary',
            payoutProvider: 'nomba',
          },
        }),
      ),
    ).rejects.toThrow('FUNDING_IDEMPOTENCY_CONFLICT');
    expect((await reservations()).ngn_reserved).toBe('40000000');
  });

  it('prevents concurrent different intents from overspending the same native balance', async () => {
    const results = await Promise.allSettled([
      store.reserve(request({ idempotencyKey: 'send-key-0001' })),
      store.reserve(request({ idempotencyKey: 'send-key-0002' })),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect((await reservations()).ngn_reserved).toBe('40000000');
    const count = await pool.query<{ count: string }>(
      `SELECT count(*) FROM "${namespace}".funding_intents`,
    );
    expect(count.rows[0].count).toBe('1');
  });

  it('persists both currency reservations and immutable conversion amounts with pinned references', async () => {
    const input = request({
      recipientMinor: '60000000',
      payoutFeeMinor: '10000',
      quote: {
        reference: 'executable-quote-1',
        sourceCurrency: 'USDC',
        destinationCurrency: 'NGN',
        sourceDebitMinor: '66733334',
        destinationCreditMinor: '10010000',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      executionBinding: {
        payoutProvider: 'paga',
        payoutDestination: 'validated-beneficiary',
        conversionProvider: 'approved-converter',
      },
    });
    const intent = await store.reserve(input);
    expect(await reservations()).toEqual({
      ngn_reserved: '50000000',
      usdc_reserved: '66733334',
    });
    expect(intent.plan.shortfallMinor).toBe('10010000');
    expect(intent.plan.conversion?.reference).toBe('executable-quote-1');
    expect(intent.payoutActionReference).not.toBe(
      intent.conversionActionReference,
    );
    intent.plan.reservations.NGN = '0';
    const restored = await store.get('alice', intent.id);
    expect(restored?.plan.reservations.NGN).toBe('50000000');
    expect(restored?.holdingsReconciliationReference).toBe(
      'reconciled-ledger-1',
    );
  });

  it('prevents consuming one executable conversion quote in two different intents', async () => {
    await pool.query(
      `UPDATE "${namespace}".funding_holdings SET usdc_settled = 200000000 WHERE owner_id = 'alice'`,
    );
    const input = request({
      recipientMinor: '60000000',
      quote: {
        reference: 'single-use-quote',
        sourceCurrency: 'USDC',
        destinationCurrency: 'NGN',
        sourceDebitMinor: '66666667',
        destinationCreditMinor: '10000000',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      executionBinding: {
        payoutProvider: 'paga',
        payoutDestination: 'validated-beneficiary',
        conversionProvider: 'approved-converter',
      },
    });
    const original = await store.reserve(input);
    expect(await store.reserve(input)).toEqual(original);
    await expect(
      store.reserve({
        ...input,
        idempotencyKey: 'second-conversion',
        recipientMinor: '10000000',
      }),
    ).rejects.toThrow('CONVERSION_QUOTE_ALREADY_RESERVED');
    expect(await reservations()).toEqual({
      ngn_reserved: '50000000',
      usdc_reserved: '66666667',
    });
  });

  it('rolls back reservations if durable intent insertion fails', async () => {
    await pool.query(
      `ALTER TABLE "${namespace}".funding_intents ADD CONSTRAINT reject_test_key CHECK (idempotency_key <> 'forced-failure')`,
    );
    try {
      await expect(
        store.reserve(request({ idempotencyKey: 'forced-failure' })),
      ).rejects.toThrow();
      expect(await reservations()).toEqual({
        ngn_reserved: '0',
        usdc_reserved: '0',
      });
    } finally {
      await pool.query(
        `ALTER TABLE "${namespace}".funding_intents DROP CONSTRAINT reject_test_key`,
      );
    }
  });

  it('rejects expired quotes without reserving funds and never accepts caller holdings', async () => {
    await expect(
      store.reserve(
        request({
          recipientMinor: '60000000',
          quote: {
            reference: 'expired',
            sourceCurrency: 'USDC',
            destinationCurrency: 'NGN',
            sourceDebitMinor: '66666667',
            destinationCreditMinor: '10000000',
            expiresAt: '2020-01-01T00:00:00.000Z',
          },
        }),
      ),
    ).rejects.toThrow('QUOTE_EXPIRED');
    await expect(
      store.reserve(request({ ownerId: 'unreconciled' })),
    ).rejects.toThrow('RECONCILED_HOLDINGS_REQUIRED');
    expect(await reservations()).toEqual({
      ngn_reserved: '0',
      usdc_reserved: '0',
    });
  });

  it('rejects an unsafe schema identifier before executing SQL', () => {
    expect(() => new PgFundingStore(pool, 'public;DROP TABLE users')).toThrow(
      'INVALID_FUNDING_SCHEMA',
    );
  });

  it('requires recent non-future reconciliation but replays already reserved intents unchanged', async () => {
    const original = await store.reserve(request());
    for (const interval of ['-60 seconds', '60 seconds']) {
      await pool.query(
        `UPDATE "${namespace}".funding_holdings SET reconciled_at = clock_timestamp() + $1::interval WHERE owner_id = 'alice'`,
        [interval],
      );
      expect(await store.reserve(request())).toEqual(original);
      await expect(
        store.reserve(
          request({
            idempotencyKey: 'another-send-1',
            recipientMinor: '1000000',
          }),
        ),
      ).rejects.toThrow('FRESH_RECONCILED_HOLDINGS_REQUIRED');
    }
    expect((await reservations()).ngn_reserved).toBe('40000000');
  });
});
