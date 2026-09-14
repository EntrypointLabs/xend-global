import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { BankingRegistry } from './banking.registry';
import { BankNotificationInbox } from './notification-inbox';
import { BankNotificationRequeryService } from './notification-requery.service';
import type { BankTransactionObservation } from './banking-provider.interface';

const describePg = process.env.FIAT_PG_TEST_DATABASE_URL
  ? describe
  : describe.skip;
describePg('bank notification requery PostgreSQL', () => {
  const namespace = `bank_query_${randomBytes(6).toString('hex')}`;
  let admin: Pool, pool: Pool, inbox: BankNotificationInbox, db: DbService;
  let observation: BankTransactionObservation;
  const lookup = jest.fn<Promise<BankTransactionObservation>, [string]>();
  const config = new ConfigService({
    NODE_ENV: 'test',
    NOMBA_SANDBOX_ACCOUNT_ID: 'merchant',
    NOMBA_SANDBOX_WEBHOOK_SECRET: 'test',
  });
  const notification = {
    eventType: 'payment_success',
    requestId: 'delivery',
    merchantId: 'merchant',
    walletId: 'wallet',
    transactionId: 'deposit',
    transactionType: 'vact_transfer',
    transactionTime: '2026-09-14T12:51:20Z',
    responseCode: '',
  };
  function service(ready = true, cfg = config) {
    return new BankNotificationRequeryService(db, cfg, {
      transactionReader: () => (ready ? { getTransaction: lookup } : null),
    } as unknown as BankingRegistry);
  }
  async function row() {
    return (
      await pool.query<{
        status: string;
        query_attempts: number;
        query_error: string | null;
        query_result: BankTransactionObservation | null;
      }>(
        'SELECT status, query_attempts, query_error, query_result FROM fiat_bank_notifications',
      )
    ).rows[0];
  }
  beforeAll(async () => {
    admin = new Pool({
      connectionString: process.env.FIAT_PG_TEST_DATABASE_URL,
    });
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    pool = new Pool({
      connectionString: process.env.FIAT_PG_TEST_DATABASE_URL,
      options: `-c search_path=${namespace}`,
    });
    for (const file of [
      '0046_bank_notifications.sql',
      '0047_bank_notification_requery.sql',
    ])
      await pool.query(readFileSync(`drizzle/${file}`, 'utf8'));
    db = { client: drizzle(pool) } as unknown as DbService;
    inbox = new BankNotificationInbox(db);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await admin.end();
    }
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM fiat_bank_notifications');
    await inbox.receive('nomba', 'sandbox', notification);
    observation = {
      transactionId: 'deposit',
      merchantId: 'merchant',
      type: 'vact_transfer',
      status: 'SUCCESS',
      amountMinor: '10000',
      feeMinor: '1000',
      createdAt: notification.transactionTime,
      source: 'api',
      evidence: 'authenticated_sandbox',
    };
    lookup.mockReset().mockImplementation(() => Promise.resolve(observation));
  });
  it('claims one notification across concurrent workers, persists requery and does not invent credit', async () => {
    const results = await Promise.all([
      service().queryNext(),
      service().queryNext(),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('deposit');
    expect(await row()).toMatchObject({
      status: 'needs_attention',
      query_attempts: 1,
      query_error: 'SETTLEMENT_RECONCILIATION_REQUIRED',
      query_result: observation,
    });
    await inbox.receive('nomba', 'sandbox', notification);
    expect(await service().queryNext()).toBe(false);
  });
  it.each([
    { transactionId: 'other' },
    { merchantId: 'other' },
    { merchantId: null },
    { type: 'transfer' },
    { createdAt: '2026-09-13T12:51:20Z' },
  ])('holds mismatched provider evidence %j', async (changes) => {
    Object.assign(observation, changes);
    await service().queryNext();
    expect(await row()).toMatchObject({
      status: 'needs_attention',
      query_error: 'TRANSACTION_IDENTITY_MISMATCH',
    });
  });
  it('backs off temporary failures and survives a worker restart', async () => {
    lookup.mockRejectedValueOnce(new Error('temporary'));
    await service().queryNext();
    expect(await row()).toMatchObject({
      status: 'received',
      query_attempts: 1,
      query_error: 'PROVIDER_QUERY_UNAVAILABLE',
    });
    expect(await service().queryNext()).toBe(false);
    await pool.query(
      "UPDATE fiat_bank_notifications SET next_query_at = now() - interval '1 second'",
    );
    await service().queryNext();
    expect(await row()).toMatchObject({
      query_attempts: 2,
      query_result: observation,
    });
  });
  it('stops automatic retries after six failed attempts', async () => {
    lookup.mockRejectedValue(new Error('temporary'));
    await pool.query('UPDATE fiat_bank_notifications SET query_attempts = 5');
    await service().queryNext();
    expect(await row()).toMatchObject({
      status: 'needs_attention',
      query_attempts: 6,
      query_error: 'PROVIDER_QUERY_UNAVAILABLE',
    });
  });
  it('recovers expired claims and fences out responses from the old worker', async () => {
    let release!: (value: BankTransactionObservation) => void;
    lookup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = service().queryNext();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
    await pool.query(
      "UPDATE fiat_bank_notifications SET next_query_at = now() - interval '1 second'",
    );
    await service().queryNext();
    release({ ...observation, amountMinor: '999999' });
    await first;
    expect(await row()).toMatchObject({
      query_attempts: 2,
      query_result: { amountMinor: '10000' },
    });
  });
  it('never queries another merchant, production events, or a disabled provider', async () => {
    expect(await service(false).queryNext()).toBe(false);
    expect(
      await service(
        true,
        new ConfigService({ NODE_ENV: 'production' }),
      ).queryNext(),
    ).toBe(false);
    await pool.query(
      "UPDATE fiat_bank_notifications SET merchant_id = 'other'",
    );
    expect(await service().queryNext()).toBe(false);
    await pool.query(
      "UPDATE fiat_bank_notifications SET merchant_id = 'merchant', environment = 'production'",
    );
    expect(await service().queryNext()).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });
});
