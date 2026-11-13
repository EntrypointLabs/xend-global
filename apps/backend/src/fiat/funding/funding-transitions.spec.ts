/** Actual PostgreSQL transition tests, isolated schema only. */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PgFundingStore, type ReservedFundingIntent } from './funding-store';
import type { FundingEvent } from './funding-state';
const describePg = process.env.FIAT_PG_TEST_DATABASE_URL
  ? describe
  : describe.skip;
describePg('atomic funding settlement journal', () => {
  const schema = `funding_events_${randomBytes(6).toString('hex')}`;
  let pool: Pool;
  let store: PgFundingStore;
  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.FIAT_PG_TEST_DATABASE_URL,
    });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(
      readFileSync(join(__dirname, 'funding-store.sql'), 'utf8').replaceAll(
        '__SCHEMA__',
        `"${schema}"`,
      ),
    );
    store = new PgFundingStore(pool, schema);
  });
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE "${schema}".funding_journal, "${schema}".funding_intents, "${schema}".funding_holdings`,
    );
    await pool.query(
      `INSERT INTO "${schema}".funding_holdings (owner_id, ngn_settled, usdc_settled, reconciliation_reference, reconciled_at) VALUES ('alice',500,100,'seed',clock_timestamp())`,
    );
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  });
  async function reserve() {
    return store.reserve({
      ownerId: 'alice',
      idempotencyKey: 'reserve-0001',
      destinationCurrency: 'USDC',
      recipientMinor: '200',
      payoutFeeMinor: '0',
      executionBinding: {
        payoutProvider: 'chain',
        payoutDestination: 'validated',
        conversionProvider: 'converter',
      },
      quote: {
        reference: 'quote',
        sourceCurrency: 'NGN',
        destinationCurrency: 'USDC',
        sourceDebitMinor: '250',
        destinationCreditMinor: '110',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    });
  }
  async function balances() {
    return (
      await pool.query<{
        ngn_settled: string;
        ngn_reserved: string;
        usdc_settled: string;
        usdc_reserved: string;
      }>(
        `SELECT ngn_settled, ngn_reserved, usdc_settled, usdc_reserved FROM "${schema}".funding_holdings WHERE owner_id='alice'`,
      )
    ).rows[0];
  }
  function event(
    intent: ReservedFundingIntent,
    type: FundingEvent['type'],
  ): FundingEvent {
    const actionReference = type.startsWith('conversion_')
      ? intent.conversionActionReference!
      : intent.payoutActionReference;
    const base = { id: type, actionReference, type };
    if (type === 'conversion_source_debited')
      return {
        ...base,
        type,
        evidence: {
          kind: 'bank_reconciliation',
          reference: 'source',
          currency: 'NGN',
          amountMinor: '250',
        },
      };
    if (type === 'conversion_destination_confirmed')
      return {
        ...base,
        type,
        evidence: {
          kind: 'onchain_finality',
          reference: 'credit',
          currency: 'USDC',
          amountMinor: '110',
        },
      };
    if (type === 'payout_confirmed')
      return {
        ...base,
        type,
        evidence: {
          kind: 'onchain_finality',
          reference: 'payout',
          currency: 'USDC',
          amountMinor: '200',
        },
      };
    if (type === 'payout_not_debited' || type === 'conversion_not_debited')
      return { ...base, type, reconciliationReference: 'verified-no-debit' };
    return base as FundingEvent;
  }
  async function apply(
    intent: ReservedFundingIntent,
    type: FundingEvent['type'],
  ) {
    return store.applyEvent('alice', intent.id, event(intent, type));
  }
  it.each([true, false])(
    'debits once, quarantines premature credits and keeps surplus; credit first=%s',
    async (creditFirst) => {
      const intent = await reserve();
      await apply(intent, 'conversion_started');
      const first = creditFirst
        ? 'conversion_destination_confirmed'
        : 'conversion_source_debited';
      await Promise.all(Array.from({ length: 4 }, () => apply(intent, first)));
      expect(await balances()).toEqual(
        creditFirst
          ? {
              ngn_settled: '500',
              ngn_reserved: '250',
              usdc_settled: '210',
              usdc_reserved: '210',
            }
          : {
              ngn_settled: '250',
              ngn_reserved: '0',
              usdc_settled: '100',
              usdc_reserved: '100',
            },
      );
      store = new PgFundingStore(pool, schema);
      await apply(
        intent,
        creditFirst
          ? 'conversion_source_debited'
          : 'conversion_destination_confirmed',
      );
      expect(await balances()).toEqual({
        ngn_settled: '250',
        ngn_reserved: '0',
        usdc_settled: '210',
        usdc_reserved: '200',
      });
      await apply(intent, 'payout_started');
      await apply(intent, 'payout_confirmed');
      await apply(intent, 'payout_confirmed');
      expect(await balances()).toEqual({
        ngn_settled: '250',
        ngn_reserved: '0',
        usdc_settled: '10',
        usdc_reserved: '0',
      });
      expect(
        (
          await pool.query<{ count: string }>(
            `SELECT count(*) FROM "${schema}".funding_journal`,
          )
        ).rows[0].count,
      ).toBe('5');
    },
  );
  it('unknown retains all reservations; reconciled payout failure retains converted currency', async () => {
    const intent = await reserve();
    await apply(intent, 'conversion_started');
    await apply(intent, 'conversion_unknown');
    expect((await balances()).ngn_reserved).toBe('250');
    await apply(intent, 'conversion_source_debited');
    await apply(intent, 'conversion_destination_confirmed');
    await apply(intent, 'payout_started');
    await apply(intent, 'payout_unknown');
    expect((await balances()).usdc_reserved).toBe('200');
    await apply(intent, 'payout_not_debited');
    expect(await balances()).toEqual({
      ngn_settled: '250',
      ngn_reserved: '0',
      usdc_settled: '210',
      usdc_reserved: '0',
    });
  });
  it('releases only after confirmed conversion non-debit; enforces ownership and conflicting replay', async () => {
    const intent = await reserve();
    await expect(
      store.applyEvent('bob', intent.id, event(intent, 'conversion_started')),
    ).rejects.toThrow('NOT_FOUND');
    await apply(intent, 'conversion_started');
    await expect(
      store.applyEvent('alice', intent.id, {
        ...event(intent, 'conversion_unknown'),
        id: 'conversion_started',
      }),
    ).rejects.toThrow('reused');
    await apply(intent, 'conversion_not_debited');
    expect(await balances()).toEqual({
      ngn_settled: '500',
      ngn_reserved: '0',
      usdc_settled: '100',
      usdc_reserved: '0',
    });
  });
  it('only one concurrent worker claims a start, with direct payout settlement', async () => {
    const intent = await store.reserve({
      ownerId: 'alice',
      idempotencyKey: 'native-send',
      destinationCurrency: 'NGN',
      recipientMinor: '200',
      payoutFeeMinor: '5',
      quote: null,
      executionBinding: {
        payoutProvider: 'bank',
        payoutDestination: 'validated',
      },
    });
    await apply(intent, 'native_funding_ready');
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        store.applyEventResult(
          'alice',
          intent.id,
          event(intent, 'payout_started'),
        ),
      ),
    );
    expect(claims.filter((result) => result.applied)).toHaveLength(1);
    await store.applyEvent('alice', intent.id, {
      id: 'paid',
      type: 'payout_confirmed',
      actionReference: intent.payoutActionReference,
      evidence: {
        kind: 'bank_reconciliation',
        reference: 'native-paid',
        currency: 'NGN',
        amountMinor: '205',
      },
    });
    expect(await balances()).toEqual({
      ngn_settled: '295',
      ngn_reserved: '0',
      usdc_settled: '100',
      usdc_reserved: '0',
    });
  });
  it('rejects one settlement reference being consumed by another intent', async () => {
    for (const key of ['native-one', 'native-two']) {
      const intent = await store.reserve({
        ownerId: 'alice',
        idempotencyKey: key,
        destinationCurrency: 'NGN',
        recipientMinor: '100',
        payoutFeeMinor: '0',
        quote: null,
        executionBinding: {
          payoutProvider: 'bank',
          payoutDestination: 'validated',
        },
      });
      await apply(intent, 'native_funding_ready');
      await apply(intent, 'payout_started');
      const settlement: FundingEvent = {
        id: 'paid',
        type: 'payout_confirmed',
        actionReference: intent.payoutActionReference,
        evidence: {
          kind: 'bank_reconciliation',
          reference: 'shared-evidence',
          currency: 'NGN',
          amountMinor: '100',
        },
      };
      if (key === 'native-one')
        await store.applyEvent('alice', intent.id, settlement);
      else {
        await expect(
          store.applyEvent('alice', intent.id, settlement),
        ).rejects.toThrow();
        expect((await store.get('alice', intent.id))?.state.status).toBe(
          'sending',
        );
      }
    }
    expect(await balances()).toEqual({
      ngn_settled: '400',
      ngn_reserved: '100',
      usdc_settled: '100',
      usdc_reserved: '0',
    });
  });
  it('rolls back journal and state if ledger update fails and prohibits journal mutation', async () => {
    const intent = await reserve();
    await apply(intent, 'conversion_started');
    await pool.query(
      `ALTER TABLE "${schema}".funding_holdings ADD CONSTRAINT injected_failure CHECK (ngn_settled=500)`,
    );
    try {
      await expect(
        apply(intent, 'conversion_source_debited'),
      ).rejects.toThrow();
      expect(
        (await store.get('alice', intent.id))?.state.conversion?.sourceDebited,
      ).toBe(false);
      expect(
        (
          await pool.query<{ count: string }>(
            `SELECT count(*) FROM "${schema}".funding_journal`,
          )
        ).rows[0].count,
      ).toBe('1');
    } finally {
      await pool.query(
        `ALTER TABLE "${schema}".funding_holdings DROP CONSTRAINT injected_failure`,
      );
    }
    await expect(
      pool.query(`UPDATE "${schema}".funding_journal SET event='{}'`),
    ).rejects.toThrow('IMMUTABLE');
    await expect(
      pool.query(`DELETE FROM "${schema}".funding_journal`),
    ).rejects.toThrow('IMMUTABLE');
  });
});
