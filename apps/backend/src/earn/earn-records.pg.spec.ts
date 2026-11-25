import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DrizzleEarnRecords, earnDeltas } from './earn-records';
import { DbService } from '../db/db.service';
import { EARN_PROVIDERS, EARN_USDC } from '@prydd/smart-account';
import type { Connection, VersionedTransactionResponse } from '@solana/web3.js';
const url = process.env.EARN_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pendingMeta = {
  messageHash: 'message-one',
  quote: { provider: 'kamino', action: 'deposit' },
  blockHeight: 100,
};
const receipt = EARN_PROVIDERS.kamino.receipt,
  vault = 'test-vault';
function confirmed(
  cashBefore: string,
  cashAfter: string,
  sharesBefore: string,
  sharesAfter: string,
): VersionedTransactionResponse {
  const rows = (cash: string, shares: string) => [
    {
      owner: vault,
      mint: EARN_USDC.toBase58(),
      accountIndex: 0,
      uiTokenAmount: { amount: cash, decimals: 6, uiAmount: null },
    },
    {
      owner: vault,
      mint: receipt,
      accountIndex: 1,
      uiTokenAmount: { amount: shares, decimals: 6, uiAmount: null },
    },
  ];
  return {
    blockTime: Math.floor(Date.now() / 1000),
    meta: {
      err: null,
      preTokenBalances: rows(cashBefore, sharesBefore),
      postTokenBalances: rows(cashAfter, sharesAfter),
    },
  } as unknown as VersionedTransactionResponse;
}
suite('Earn ledger against Postgres', () => {
  let client: Client, records: DrizzleEarnRecords;
  const schema = `earn_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query('CREATE TABLE users (id text primary key)');
    await client.query("INSERT INTO users VALUES ('consumer')");
    const migration = readFileSync(
      join(__dirname, '../../drizzle/0069_earn_operations.sql'),
      'utf8',
    ).replace('REFERENCES "public"."users"', `REFERENCES "${schema}"."users"`);
    await client.query(migration);
    records = new DrizzleEarnRecords({
      client: drizzle(client),
    } as unknown as DbService);
  });
  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
  beforeEach(async () => {
    await client.query('TRUNCATE earn_operations');
  });
  it('deduplicates the signed broadcast and computes confirmed income from actual deltas', async () => {
    const pending = {
      ...pendingMeta,
      userId: 'consumer',
      signature: 'sig-one',
      vault,
      provider: 'kamino' as const,
      action: 'deposit' as const,
      wire: 'signed-wire',
    };
    await records.pending(pending);
    await records.pending(pending);
    expect(
      (
        await client.query<{ n: number }>(
          'SELECT count(*)::int as n FROM earn_operations',
        )
      ).rows[0].n,
    ).toBe(1);
    expect((await records.recover('consumer', 'message-one'))?.wire).toBe(
      'signed-wire',
    );
    expect(await records.recover('another-consumer', 'message-one')).toBeNull();
    const rpc = {
      getTransaction: jest
        .fn()
        .mockResolvedValue(confirmed('20000000', '10000000', '0', '9000000')),
    } as unknown as Connection;
    await records.reconcile('consumer', rpc);
    const stored = (
      await client.query<{
        status: string;
        wire: string | null;
        cash_delta_raw: string;
      }>('SELECT * FROM earn_operations')
    ).rows[0];
    expect(stored.status).toBe('confirmed');
    expect(stored.wire).toBeNull();
    expect(stored.cash_delta_raw).toBe('-10000000');
    expect(
      await records.earnings('consumer', {
        kamino: { shares: 9000000n, value: 11000000n },
        jupiter: { shares: 0n, value: 0n },
      }),
    ).toEqual({ lifetimeMinor: '1000000', lastSevenDaysMinor: '1000000' });
  });
  it('leaves income unknown for externally received shares and for a missing seven-day baseline', async () => {
    expect(
      await records.earnings('consumer', {
        kamino: { shares: 1n, value: 1n },
        jupiter: { shares: 0n, value: 0n },
      }),
    ).toEqual({ lifetimeMinor: null, lastSevenDaysMinor: null });
    await records.pending({
      ...pendingMeta,
      userId: 'consumer',
      signature: 'sig-old',
      vault,
      provider: 'kamino',
      action: 'deposit',
      wire: 'wire',
    });
    await client.query(
      "UPDATE earn_operations SET status='confirmed', cash_delta_raw='-100',share_delta_raw='100',confirmed_at=now()-interval '8 days'",
    );
    expect(
      await records.earnings('consumer', {
        kamino: { shares: 100n, value: 110n },
        jupiter: { shares: 0n, value: 0n },
      }),
    ).toEqual({ lifetimeMinor: '10', lastSevenDaysMinor: null });
  });
  it('reconciles older confirmed transfers beyond a page of unresolved broadcasts', async () => {
    await records.pending({
      ...pendingMeta,
      userId: 'consumer',
      signature: 'z-confirmed',
      vault,
      provider: 'kamino',
      action: 'deposit',
      wire: 'wire',
    });
    await client.query(
      "UPDATE earn_operations SET created_at=now()-interval '1 day'",
    );
    await client.query(
      `INSERT INTO earn_operations (signature,user_id,provider,action,vault,wire,message_hash,quote,block_height) SELECT 'blocker-'||lpad(g::text,3,'0'),'consumer','kamino','deposit','test-vault','wire','hash-'||g,'{}'::jsonb,100 FROM generate_series(1,103) g`,
    );
    const getTransaction = jest.fn((signature: string) =>
      Promise.resolve(
        signature === 'z-confirmed' ? confirmed('20', '10', '0', '9') : null,
      ),
    );
    await records.reconcile('consumer', {
      getTransaction,
    } as unknown as Connection);
    expect(
      (
        await client.query(
          "SELECT status,cash_delta_raw,share_delta_raw FROM earn_operations WHERE signature='z-confirmed'",
        )
      ).rows[0],
    ).toEqual({
      status: 'confirmed',
      cash_delta_raw: '-10',
      share_delta_raw: '9',
    });
    expect(getTransaction).toHaveBeenCalledTimes(104);
    expect(
      new Set(getTransaction.mock.calls.map(([signature]) => signature)).size,
    ).toBe(104);
    expect(
      await records.earnings('consumer', {
        kamino: { shares: 9n, value: 11n },
        jupiter: { shares: 0n, value: 0n },
      }),
    ).toEqual({ lifetimeMinor: '1', lastSevenDaysMinor: '1' });
  });
  it('does not count unconfirmed or failed transactions as earnings', async () => {
    await records.pending({
      ...pendingMeta,
      userId: 'consumer',
      signature: 'sig-failed',
      vault,
      provider: 'kamino',
      action: 'deposit',
      wire: 'wire',
    });
    await records.reconcile('consumer', {
      getTransaction: jest.fn().mockResolvedValue(null),
    } as unknown as Connection);
    expect(
      (
        await client.query<{ status: string }>(
          'SELECT status FROM earn_operations',
        )
      ).rows[0].status,
    ).toBe('pending');
    await records.reconcile('consumer', {
      getTransaction: jest.fn().mockResolvedValue({
        meta: { err: { InstructionError: [0, 'failure'] } },
      }),
    } as unknown as Connection);
    expect(
      (await client.query('SELECT status,wire FROM earn_operations')).rows[0],
    ).toEqual({ status: 'failed', wire: null });
  });
});
describe('Earn delta parsing', () => {
  it('only attributes tokens owned by the Account and refuses failed metadata', () => {
    const tx = confirmed('20', '10', '0', '9');
    expect(earnDeltas(tx, vault, receipt)).toEqual({ cash: -10n, shares: 9n });
    expect(earnDeltas(tx, 'another-vault', receipt)).toEqual({
      cash: 0n,
      shares: 0n,
    });
    expect(
      earnDeltas(
        {
          ...tx,
          meta: { ...tx.meta!, err: { InstructionError: [0, 'failure'] } },
        },
        vault,
        receipt,
      ),
    ).toBeNull();
  });
});
