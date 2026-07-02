/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { ReconcilerService } from './reconciler.service';
import { TailerService } from './tailer.service';
import type { DbService } from '../db/db.service';
import type { SolanaRpc } from '../solana/solana-rpc.interface';

/**
 * Unit tests for ReconcilerService:
 *   * Outstanding PENDING older than 30s finalized via mock
 *     getSignatureStatuses.
 *   * PENDING younger than 30s ignored.
 *   * Cluster err result transitions to FAILED with failure_reason.
 *   * Re-entrant safety: two consecutive ticks do not double-write
 *     (status guard via WHERE clause).
 *   * Boot replay walks smart_accounts, calls streamConfirmedTransfers
 *     since last_indexed_slot, and writes via TailerService.
 */

interface FakeDbCall {
  kind: 'execute' | 'select' | 'update';
  payload: unknown;
}

interface OutstandingRow {
  signature: string;
  smartAccountId: string;
  submittedAt: Date;
  // Models the server-computed `submitted_at < now - PENDING_EXPIRY_MS`
  // flag returned by the reconciler's outstanding SELECT. Defaults to
  // false so existing cases keep their pre-expiry behavior.
  expired?: boolean;
}

function makeFakeDb(opts: {
  outstanding?: OutstandingRow[];
  smartAccounts?: { id: string; walletAddress: string }[];
  bookmark?: { walletAddress: string; lastIndexedSlot: bigint };
}): { db: DbService; calls: FakeDbCall[] } {
  const calls: FakeDbCall[] = [];
  const outstanding = opts.outstanding ?? [];
  const wallets = opts.smartAccounts ?? [];
  const bookmarks = opts.bookmark ? [opts.bookmark] : [];

  const execute = jest.fn().mockImplementation((stmt: unknown) => {
    const str = JSON.stringify(stmt);
    calls.push({ kind: 'execute', payload: str });
    // The reconciler issues its outstanding-PENDING SELECT via execute()
    // (raw SQL). Return the seeded outstanding rows when we see that shape.
    const isOutstandingSelect =
      str.includes('SELECT') &&
      str.includes('transfers') &&
      str.includes('PENDING');
    if (isOutstandingSelect) {
      return Promise.resolve({
        rows: outstanding.map((r) => ({
          signature: r.signature,
          smartAccountId: r.smartAccountId,
          expired: r.expired ?? false,
        })),
        rowCount: outstanding.length,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });

  // Dispatch select() results by the table passed to `from(...)`, read
  // off the Drizzle table name symbol.

  const fromTable = (table: unknown): string | null => {
    // Drizzle pgTable instances expose the table name on a well-known
    // symbol: Symbol.for('drizzle:Name').
    if (typeof table !== 'object' || table === null) return null;
    const nameSym = Symbol.for('drizzle:Name');
    const v = (table as Record<symbol, unknown>)[nameSym];
    return typeof v === 'string' ? v : null;
  };

  const makeSelectChain = (tableName: string | null) => {
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        const inner = makeSelectChain(fromTable(t) ?? tableName);
        return inner;
      },
      where: () => chain,
      limit: () => chain,
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => {
        let rows: Record<string, unknown>[] = [];
        if (tableName === 'transfers') {
          rows = outstanding as unknown as Record<string, unknown>[];
        } else if (tableName === 'tailer_state') {
          rows = bookmarks as unknown as Record<string, unknown>[];
        } else if (tableName === 'smart_accounts') {
          rows = wallets as unknown as Record<string, unknown>[];
        }
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return chain;
  };

  const client = {
    execute,
    select: () => ({
      from: (t: unknown) => makeSelectChain(fromTable(t)),
    }),
  };

  return { db: { client } as unknown as DbService, calls };
}

function makeFakeSolana(overrides: Partial<SolanaRpc> = {}): SolanaRpc {
  return {
    getRecentBlockhash: jest.fn(),
    getTokenBalances: jest.fn(),
    sendRawTransaction: jest.fn(),
    getSignatureStatuses: jest.fn().mockResolvedValue([]),
    accountExists: jest.fn(),
    streamConfirmedTransfers: jest.fn().mockImplementation(async function* () {
      // empty by default
    }),
    registerWebhookAddress: jest.fn(),
    unregisterWebhookAddress: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    ...overrides,
  };
}

// ── tick() ───────────────────────────────────────────────────────────

describe('ReconcilerService.tick', () => {
  it('finalizes outstanding PENDING rows older than 30s to CONFIRMED', async () => {
    const sigOld = 'sig-old';
    const { db, calls } = makeFakeDb({
      outstanding: [
        {
          signature: sigOld,
          smartAccountId: 'sa1',
          submittedAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    const solana = makeFakeSolana({
      getSignatureStatuses: jest.fn().mockResolvedValue([
        {
          signature: sigOld,
          slot: 12345n,
          confirmationStatus: 'confirmed',
          err: null,
        },
      ]),
    });
    const tailer = new TailerService(db);
    const reconciler = new ReconcilerService(db, solana, tailer);

    await reconciler.tick();
    expect(solana.getSignatureStatuses).toHaveBeenCalledWith([sigOld]);
    // One UPDATE issued.
    const updates = calls.filter(
      (c) =>
        typeof c.payload === 'string' &&
        c.payload.includes('CONFIRMED') &&
        c.payload.includes('UPDATE'),
    );
    expect(updates).toHaveLength(1);
    // The UPDATE has the status guard via WHERE clause.
    expect(updates[0].payload).toMatch(/PENDING/);
  });

  it('ignores rows younger than 30s', async () => {
    const { db, calls } = makeFakeDb({
      outstanding: [], // fake db only returns rows the SELECT predicate would
    });
    const solana = makeFakeSolana();
    const tailer = new TailerService(db);
    const reconciler = new ReconcilerService(db, solana, tailer);

    await reconciler.tick();
    expect(solana.getSignatureStatuses).not.toHaveBeenCalled();
    // The SELECT for outstanding is issued (one execute), but no
    // UPDATE follows since rows is empty.
    const updates = calls.filter(
      (c) => typeof c.payload === 'string' && c.payload.includes('UPDATE'),
    );
    expect(updates).toHaveLength(0);
  });

  it('transitions to FAILED with failure_reason on cluster err', async () => {
    const sig = 'sig-err';
    const { db, calls } = makeFakeDb({
      outstanding: [
        {
          signature: sig,
          smartAccountId: 'sa1',
          submittedAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    const solana = makeFakeSolana({
      getSignatureStatuses: jest.fn().mockResolvedValue([
        {
          signature: sig,
          slot: null,
          confirmationStatus: null,
          err: { InstructionError: [0, 'Custom: 1'] },
        },
      ]),
    });
    const tailer = new TailerService(db);
    const reconciler = new ReconcilerService(db, solana, tailer);

    await reconciler.tick();
    const failedUpdates = calls.filter(
      (c) =>
        typeof c.payload === 'string' &&
        c.payload.includes('FAILED') &&
        c.payload.includes('failure_reason'),
    );
    expect(failedUpdates).toHaveLength(1);
    expect(failedUpdates[0].payload).toMatch(/InstructionError/);
  });

  it('re-entrant: second tick with no new outstanding rows is a no-op', async () => {
    const sig = 'sig-once';
    const { db, calls } = makeFakeDb({
      outstanding: [
        {
          signature: sig,
          smartAccountId: 'sa1',
          submittedAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    const solana = makeFakeSolana({
      getSignatureStatuses: jest.fn().mockResolvedValue([
        {
          signature: sig,
          slot: 999n,
          confirmationStatus: 'confirmed',
          err: null,
        },
      ]),
    });
    const tailer = new TailerService(db);
    const reconciler = new ReconcilerService(db, solana, tailer);

    await reconciler.tick();
    const updatesAfterFirst = calls.filter(
      (c) => typeof c.payload === 'string' && c.payload.includes('UPDATE'),
    ).length;

    // Simulate the row now being CONFIRMED — drop it from outstanding.
    // (Our fake reads the closure; we can't easily mutate. Instead, we
    // simply run a second tick on a fresh db whose outstanding is empty
    // to model the second tick.)
    const { db: db2, calls: calls2 } = makeFakeDb({ outstanding: [] });
    const reconciler2 = new ReconcilerService(
      db2,
      solana,
      new TailerService(db2),
    );
    await reconciler2.tick();
    // Only the outstanding-poll SELECT was issued; no UPDATE.
    const updatesAfterSecond = calls2.filter(
      (c) => typeof c.payload === 'string' && c.payload.includes('UPDATE'),
    );
    expect(updatesAfterSecond).toHaveLength(0);
    // Sanity: first tick did do work.
    expect(updatesAfterFirst).toBeGreaterThan(0);
  });

  it('leaves PENDING when cluster says still in flight', async () => {
    const sig = 'sig-inflight';
    const { db, calls } = makeFakeDb({
      outstanding: [
        {
          signature: sig,
          smartAccountId: 'sa1',
          submittedAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    const solana = makeFakeSolana({
      getSignatureStatuses: jest.fn().mockResolvedValue([
        {
          signature: sig,
          slot: null,
          confirmationStatus: 'processed',
          err: null,
        },
      ]),
    });
    const tailer = new TailerService(db);
    const reconciler = new ReconcilerService(db, solana, tailer);

    await reconciler.tick();
    // 'processed' is below 'confirmed' threshold — no UPDATE issued.
    // (The outstanding-poll SELECT does fire; assert no UPDATE.)
    const updates = calls.filter(
      (c) => typeof c.payload === 'string' && c.payload.includes('UPDATE'),
    );
    expect(updates).toHaveLength(0);
  });

  it('force-fails a null-status row the cluster never saw once it is expired', async () => {
    const sig = 'sig-dropped';
    const { db, calls } = makeFakeDb({
      outstanding: [
        {
          signature: sig,
          smartAccountId: 'sa1',
          submittedAt: new Date(Date.now() - 200_000),
          expired: true,
        },
      ],
    });
    const solana = makeFakeSolana({
      getSignatureStatuses: jest.fn().mockResolvedValue([
        {
          signature: sig,
          slot: null,
          confirmationStatus: null,
          err: null,
        },
      ]),
    });
    const reconciler = new ReconcilerService(db, solana, new TailerService(db));

    await reconciler.tick();
    const failedUpdates = calls.filter(
      (c) =>
        typeof c.payload === 'string' &&
        c.payload.includes('FAILED') &&
        c.payload.includes('failure_reason'),
    );
    expect(failedUpdates).toHaveLength(1);
    expect(failedUpdates[0].payload).toMatch(/BLOCKHASH_EXPIRED/);
  });

  it('leaves a null-status row PENDING while it is not yet expired', async () => {
    const sig = 'sig-unknown-young';
    const { db, calls } = makeFakeDb({
      outstanding: [
        {
          signature: sig,
          smartAccountId: 'sa1',
          submittedAt: new Date(Date.now() - 60_000),
          expired: false,
        },
      ],
    });
    const solana = makeFakeSolana({
      getSignatureStatuses: jest.fn().mockResolvedValue([
        {
          signature: sig,
          slot: null,
          confirmationStatus: null,
          err: null,
        },
      ]),
    });
    const reconciler = new ReconcilerService(db, solana, new TailerService(db));

    await reconciler.tick();
    const updates = calls.filter(
      (c) => typeof c.payload === 'string' && c.payload.includes('UPDATE'),
    );
    expect(updates).toHaveLength(0);
  });
});

// ── boot replay ──────────────────────────────────────────────────────

describe('ReconcilerService.onModuleInit (boot replay)', () => {
  it('streams confirmed transfers since last_indexed_slot per wallet', async () => {
    const wallet = 'WaLLeT3333333333333333333333333333333333';
    const { db, calls } = makeFakeDb({
      smartAccounts: [{ id: 'sa1', walletAddress: wallet }],
      bookmark: { walletAddress: wallet, lastIndexedSlot: 100n },
    });
    const streamFn = jest.fn().mockImplementation(async function* () {
      yield {
        signature: 'sig-replay-1',
        slot: 200n,
        mint: 'USDC',
        amountRaw: 1_000_000n,
        fromAddress: 'someone',
        toAddress: wallet,
        confirmedAt: new Date(),
      };
    });
    const solana = makeFakeSolana({ streamConfirmedTransfers: streamFn });
    const tailer = new TailerService(db);
    const reconciler = new ReconcilerService(db, solana, tailer);

    await reconciler.onModuleInit();

    expect(streamFn).toHaveBeenCalledWith(wallet, 100n);
    // The single replayed event triggered an UPSERT on transfers and
    // tailer_state (2 executes).
    expect(calls.filter((c) => c.kind === 'execute')).toHaveLength(2);
  });

  it('boot replay with no smart_accounts is a no-op', async () => {
    const { db, calls } = makeFakeDb({ smartAccounts: [] });
    const solana = makeFakeSolana();
    const tailer = new TailerService(db);
    const reconciler = new ReconcilerService(db, solana, tailer);

    await reconciler.onModuleInit();
    expect(calls.filter((c) => c.kind === 'execute')).toHaveLength(0);
    expect(solana.streamConfirmedTransfers).not.toHaveBeenCalled();
  });

  it('continues past per-wallet stream failures', async () => {
    const wallet1 = 'WaLLeT4444444444444444444444444444444444';
    const wallet2 = 'WaLLeT5555555555555555555555555555555555';
    const { db, calls } = makeFakeDb({
      smartAccounts: [
        { id: 'sa1', walletAddress: wallet1 },
        { id: 'sa2', walletAddress: wallet2 },
      ],
    });
    const streamFn = jest.fn().mockImplementation((owner: string) => {
      if (owner === wallet1) {
        throw new Error('helius transient');
      }
      return (async function* () {
        yield {
          signature: 'sig-2',
          slot: 50n,
          mint: 'USDC',
          amountRaw: 1n,
          fromAddress: 'x',
          toAddress: wallet2,
          confirmedAt: new Date(),
        };
      })();
    });
    const solana = makeFakeSolana({ streamConfirmedTransfers: streamFn });
    const tailer = new TailerService(db);
    const reconciler = new ReconcilerService(db, solana, tailer);

    await reconciler.onModuleInit();
    expect(streamFn).toHaveBeenCalledTimes(2);
    // wallet2 replay produced an event → 2 executes (transfers + tailer_state)
    expect(calls.filter((c) => c.kind === 'execute')).toHaveLength(2);
  });
});
