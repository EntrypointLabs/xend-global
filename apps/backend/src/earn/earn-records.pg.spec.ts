import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DrizzleEarnRecords, earnDeltas } from './earn-records';
import { totalEarnings } from './earn-history';
import type { TokenPriceProvider } from '../prices/token-price.interface';
import { DbService } from '../db/db.service';
import {
  associatedTokenAddress,
  EARN_PROVIDERS,
  EARN_USDC,
  JUPITER_EARN_ASSETS,
  TOKEN_PROGRAM_ID,
} from '@prydd/smart-account';
import {
  PublicKey,
  type Connection,
  type VersionedTransactionResponse,
} from '@solana/web3.js';
const url = process.env.EARN_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const USDC = EARN_USDC.toBase58();
const SOL = 'So11111111111111111111111111111111111111112';
const pendingMeta = {
  mint: USDC,
  messageHash: 'message-one',
  quote: { provider: 'kamino', action: 'deposit' },
  blockHeight: 100,
};
const receipt = EARN_PROVIDERS.kamino.receipt,
  vault = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
const wrappedSol = associatedTokenAddress(
  new PublicKey(vault),
  new PublicKey('So11111111111111111111111111111111111111112'),
  TOKEN_PROGRAM_ID,
).toBase58();
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
function solDeposit(
  lamportsBefore: number,
  lamportsAfter: number,
  sharesAfter: string,
  wrapped: [before: number, after: number] = [0, 0],
): VersionedTransactionResponse {
  const shares = (amount: string) => [
    {
      owner: vault,
      mint: JUPITER_EARN_ASSETS.SOL.receipt,
      accountIndex: 2,
      uiTokenAmount: { amount, decimals: 9, uiAmount: null },
    },
  ];
  return {
    blockTime: Math.floor(Date.now() / 1000),
    transaction: {
      message: {
        getAccountKeys: () => ({
          keySegments: () => [
            [
              { toBase58: () => 'sponsor' },
              { toBase58: () => vault },
              { toBase58: () => wrappedSol },
            ],
          ],
        }),
      },
    },
    meta: {
      err: null,
      loadedAddresses: { writable: [], readonly: [] },
      preBalances: [5_000_000_000, lamportsBefore, wrapped[0]],
      postBalances: [4_990_000_000, lamportsAfter, wrapped[1]],
      preTokenBalances: [],
      postTokenBalances: shares(sharesAfter),
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
    await client.query(
      readFileSync(
        join(__dirname, '../../drizzle/0070_earn_position_snapshots.sql'),
        'utf8',
      ).replace(
        'REFERENCES "public"."users"',
        `REFERENCES "${schema}"."users"`,
      ),
    );
    await client.query(
      readFileSync(
        join(__dirname, '../../drizzle/0071_earn_asset_mint.sql'),
        'utf8',
      ),
    );
    const prices: TokenPriceProvider = {
      getUsdPrices: (mints) =>
        Promise.resolve(
          new Map(
            mints
              .filter((m) => m === USDC || m === SOL)
              .map((m) => [
                m,
                {
                  usdPrice: m === SOL ? 150 : 1,
                  priceChange24h: null,
                  decimals: m === SOL ? 9 : 6,
                },
              ]),
          ),
        ),
    };
    records = new DrizzleEarnRecords(
      { client: drizzle(client) } as unknown as DbService,
      prices,
    );
  });
  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
  beforeEach(async () => {
    await client.query('TRUNCATE earn_operations, earn_position_snapshots');
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
      totalEarnings(
        await records.earnings('consumer', [
          {
            provider: 'kamino',
            mint: USDC,
            shares: 9000000n,
            value: 11000000n,
          },
          { provider: 'jupiter', mint: USDC, shares: 0n, value: 0n },
        ]),
      ),
    ).toMatchObject({
      lifetimeMinor: '1000000',
      lastSevenDaysMinor: '1000000',
    });
  });
  it('leaves income unknown for externally received shares and for a missing seven-day baseline', async () => {
    expect(
      totalEarnings(
        await records.earnings('consumer', [
          { provider: 'kamino', mint: USDC, shares: 1n, value: 1n },
          { provider: 'jupiter', mint: USDC, shares: 0n, value: 0n },
        ]),
      ),
    ).toMatchObject({ lifetimeMinor: null, lastSevenDaysMinor: null });
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
      totalEarnings(
        await records.earnings('consumer', [
          { provider: 'kamino', mint: USDC, shares: 100n, value: 110n },
          { provider: 'jupiter', mint: USDC, shares: 0n, value: 0n },
        ]),
      ),
    ).toMatchObject({ lifetimeMinor: '10', lastSevenDaysMinor: null });
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
      `INSERT INTO earn_operations (signature,user_id,provider,mint,action,vault,wire,message_hash,quote,block_height) SELECT 'blocker-'||lpad(g::text,3,'0'),'consumer','kamino','${USDC}','deposit','${vault}','wire','hash-'||g,'{}'::jsonb,100 FROM generate_series(1,103) g`,
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
      totalEarnings(
        await records.earnings('consumer', [
          { provider: 'kamino', mint: USDC, shares: 9n, value: 11n },
          { provider: 'jupiter', mint: USDC, shares: 0n, value: 0n },
        ]),
      ),
    ).toMatchObject({ lifetimeMinor: '1', lastSevenDaysMinor: '1' });
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
  it('keeps one snapshot per position per day and lists only users with confirmed Earn', async () => {
    await client.query(
      "INSERT INTO users VALUES ('other') ON CONFLICT DO NOTHING",
    );
    await records.pending({
      ...pendingMeta,
      userId: 'other',
      signature: 'sig-unconfirmed',
      vault,
      provider: 'kamino',
      action: 'deposit',
      wire: 'wire',
    });
    await records.pending({
      ...pendingMeta,
      messageHash: 'message-two',
      userId: 'consumer',
      signature: 'sig-confirmed',
      vault,
      provider: 'jupiter',
      action: 'deposit',
      wire: 'wire',
    });
    await client.query(
      "UPDATE earn_operations SET status='confirmed' WHERE signature='sig-confirmed'",
    );
    expect(await records.usersWithEarn()).toEqual(['consumer']);
    expect(await records.positionsWithHistory('consumer')).toEqual(new Set());
    await records.recordSnapshots('consumer', '2026-11-01', [
      {
        provider: 'jupiter',
        mint: USDC,
        valueMinor: '100',
        netDepositedMinor: '100',
      },
    ]);
    await records.recordSnapshots('consumer', '2026-11-25', [
      {
        provider: 'jupiter',
        mint: USDC,
        valueMinor: '101',
        netDepositedMinor: '100',
      },
      {
        provider: 'kamino',
        mint: USDC,
        valueMinor: '0',
        netDepositedMinor: '0',
      },
    ]);
    await records.recordSnapshots('consumer', '2026-11-25', [
      {
        provider: 'jupiter',
        mint: USDC,
        valueMinor: '102',
        netDepositedMinor: '100',
      },
    ]);
    await records.recordSnapshots('consumer', '2026-11-26', []);
    expect(await records.positionsWithHistory('consumer')).toEqual(
      new Set([`jupiter:${USDC}`, `kamino:${USDC}`]),
    );
    expect(
      await records.snapshots(
        'consumer',
        { provider: 'jupiter', mint: USDC },
        null,
      ),
    ).toEqual([
      { day: '2026-11-01', valueMinor: '100', netDepositedMinor: '100' },
      { day: '2026-11-25', valueMinor: '102', netDepositedMinor: '100' },
    ]);
    expect(
      await records.snapshots(
        'consumer',
        { provider: 'jupiter', mint: USDC },
        '2026-11-19',
      ),
    ).toEqual([
      { day: '2026-11-25', valueMinor: '102', netDepositedMinor: '100' },
    ]);
    expect(
      await records.snapshots(
        'other',
        { provider: 'jupiter', mint: USDC },
        null,
      ),
    ).toEqual([]);
  });
  it('measures seven-day income from the week-old snapshot, or the earliest one', async () => {
    await records.pending({
      ...pendingMeta,
      userId: 'consumer',
      signature: 'sig-old-jupiter',
      vault,
      provider: 'jupiter',
      action: 'deposit',
      wire: 'wire',
    });
    await records.pending({
      ...pendingMeta,
      messageHash: 'message-kamino',
      userId: 'consumer',
      signature: 'sig-old-kamino',
      vault,
      provider: 'kamino',
      action: 'deposit',
      wire: 'wire',
    });
    await client.query(
      "UPDATE earn_operations SET status='confirmed', cash_delta_raw='-1000', share_delta_raw='1000', confirmed_at=now()-interval '30 days'",
    );
    const day = (n: number) =>
      new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await records.recordSnapshots('consumer', day(20), [
      {
        provider: 'jupiter',
        mint: USDC,
        valueMinor: '1005',
        netDepositedMinor: '1000',
      },
    ]);
    await records.recordSnapshots('consumer', day(8), [
      {
        provider: 'jupiter',
        mint: USDC,
        valueMinor: '1010',
        netDepositedMinor: '1000',
      },
    ]);
    await records.recordSnapshots('consumer', day(3), [
      {
        provider: 'jupiter',
        mint: USDC,
        valueMinor: '1030',
        netDepositedMinor: '1000',
      },
      {
        provider: 'kamino',
        mint: USDC,
        valueMinor: '1004',
        netDepositedMinor: '1000',
      },
    ]);
    const result = await records.earnings('consumer', [
      { provider: 'kamino', mint: USDC, shares: 1000n, value: 1006n },
      { provider: 'jupiter', mint: USDC, shares: 1000n, value: 1040n },
    ]);
    expect(result.find((r) => r.provider === 'jupiter')).toMatchObject({
      lifetimeMinor: '40',
      lastSevenDaysMinor: '30',
    });
    expect(result.find((r) => r.provider === 'kamino')).toMatchObject({
      lifetimeMinor: '6',
      lastSevenDaysMinor: '2',
    });
    expect(totalEarnings(result)).toMatchObject({
      lifetimeMinor: '46',
      lastSevenDaysMinor: '32',
    });
  });
  it('keeps a SOL position apart from USDC at the same provider and prices what moved', async () => {
    await records.pending({
      ...pendingMeta,
      mint: SOL,
      messageHash: 'message-sol',
      userId: 'consumer',
      signature: 'sig-sol',
      vault,
      provider: 'jupiter',
      action: 'deposit',
      wire: 'wire',
    });
    await records.reconcile('consumer', {
      getTransaction: jest
        .fn()
        .mockResolvedValue(
          solDeposit(3_000_000_000, 1_000_000_000, '1900000000'),
        ),
    } as unknown as Connection);
    expect(
      (
        await client.query(
          'SELECT status,mint,cash_delta_raw,share_delta_raw,usd_value FROM earn_operations',
        )
      ).rows[0],
    ).toEqual({
      status: 'confirmed',
      mint: SOL,
      cash_delta_raw: '-2000000000',
      share_delta_raw: '1900000000',
      usd_value: '300.000000',
    });
    const result = await records.earnings('consumer', [
      { provider: 'jupiter', mint: USDC, shares: 0n, value: 0n },
      {
        provider: 'jupiter',
        mint: SOL,
        shares: 1_900_000_000n,
        value: 2_000_100_000n,
      },
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        mint: USDC,
        lifetimeMinor: '0',
        netDepositedMinor: '0',
      }),
      expect.objectContaining({
        mint: SOL,
        lifetimeMinor: '100000',
        netDepositedMinor: '2000000000',
      }),
    ]);
  });
});
describe('Earn delta parsing', () => {
  it('only attributes tokens owned by the Account and refuses failed metadata', () => {
    const tx = confirmed('20', '10', '0', '9');
    expect(earnDeltas(tx, vault, receipt, USDC)).toEqual({
      cash: -10n,
      shares: 9n,
    });
    expect(earnDeltas(tx, 'another-vault', receipt, USDC)).toEqual({
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
        USDC,
      ),
    ).toBeNull();
  });
  it('reads native SOL from the vault lamports, not a wrapped balance', () => {
    expect(
      earnDeltas(
        solDeposit(3_000_000_000, 1_000_000_000, '1900000000'),
        vault,
        JUPITER_EARN_ASSETS.SOL.receipt,
        SOL,
      ),
    ).toEqual({ cash: -2_000_000_000n, shares: 1_900_000_000n });
  });
  it('keeps the rent of an existing wrapped-SOL account out of the SOL deposit', () => {
    // 1 SOL lent; closing the vault's own wrapped-SOL account returned its rent.
    expect(
      earnDeltas(
        solDeposit(3_000_000_000, 2_002_039_280, '950000000', [2_039_280, 0]),
        vault,
        JUPITER_EARN_ASSETS.SOL.receipt,
        SOL,
      ),
    ).toEqual({ cash: -1_000_000_000n, shares: 950_000_000n });
  });
});
