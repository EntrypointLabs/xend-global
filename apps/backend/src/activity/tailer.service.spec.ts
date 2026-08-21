/* eslint-disable @typescript-eslint/unbound-method */
import { TailerService } from './tailer.service';
import type { TokenNamer } from '../tokens/token-namer.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { TokenPriceProvider } from '../prices/token-price.interface';
import { EventParser, HeliusWebhookBody } from './event-parser';
import { WebhookController } from './webhook.controller';
import type { DbService } from '../db/db.service';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { ConfirmedTransferEvent } from '../solana/solana-rpc.interface';
import { HttpException, HttpStatus } from '@nestjs/common';

/** Names the mints these tests use; anything else goes unnamed, as in life. */
function fakeNamer(): TokenNamer {
  return {
    symbolFor: jest.fn((mint: string) =>
      Promise.resolve(
        mint === 'So11111111111111111111111111111111111111112' ? 'SOL' : '',
      ),
    ),
  } as unknown as TokenNamer;
}

/**
 * Notifications are decoration on a write: a transfer row must land whether or
 * not anyone can be told about it.
 */
function fakeNotifications(): NotificationsService {
  return {
    notifyArrival: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;
}

/**
 * Prices are decoration on the write path: a transfer row must be written
 * whether or not anything can value it. Empty by default so these tests keep
 * asserting the write itself.
 */
function fakePriceProvider(
  prices: Record<string, { usdPrice: number; decimals: number | null }> = {},
): TokenPriceProvider {
  return {
    getUsdPrices: jest
      .fn()
      .mockResolvedValue(
        new Map(
          Object.entries(prices).map(([mint, p]) => [
            mint,
            { ...p, priceChange24h: null },
          ]),
        ),
      ),
  } as unknown as TokenPriceProvider;
}

/**
 * Tests for TailerService + WebhookController + EventParser:
 *   * Webhook with valid HMAC + matching wallet writes CONFIRMED row.
 *   * Webhook with bad HMAC returns 401, no DB writes.
 *   * Event for unknown wallet is skipped (no DB writes).
 *   * Duplicate signature webhook is idempotent (ON CONFLICT).
 *   * CONFIRMED row NOT regressed to PENDING by late webhook.
 *
 * The DbService is faked: db.client.execute() is a jest.fn that records
 * sql template literals so we can assert on call counts + presence of the
 * status-guard CASE clause without booting Postgres.
 */

interface FakeDbCall {
  sql: string;
  params: unknown[];
}

interface SmartAccountRow {
  id: string;
  walletAddress: string;
}

function makeFakeDb(
  ownedAccounts: SmartAccountRow[] = [],
  correlatedPaymentId?: string,
  /**
   * Vault rows as the join returns them: `walletAddress` is the vault
   * address, `id` the owning smart_accounts.id.
   */
  ownedVaults: SmartAccountRow[] = [],
  /** What the upsert's RETURNING says: a fresh row, or a conflict update. */
  insertedRows = true,
): {
  db: DbService;
  calls: FakeDbCall[];
} {
  const calls: FakeDbCall[] = [];
  const execute = jest.fn().mockImplementation((stmt: unknown) => {
    // Drizzle's sql template returns a SQL object with `.queryChunks` /
    // toSQL(); for the fake we coerce to string and stash any
    // embedded values so tests can grep.
    const str =
      typeof stmt === 'object' && stmt !== null && 'queryChunks' in stmt
        ? JSON.stringify(stmt)
        : String(stmt);
    calls.push({ sql: str, params: [] });
    // The signature->payment correlation lookup (the only query joining
    // payments) returns the configured payment id.
    if (str.includes('INSERT INTO transfers')) {
      return Promise.resolve({
        rows: [{ inserted: insertedRows }],
        rowCount: 1,
      });
    }
    if (str.includes('JOIN payments')) {
      return Promise.resolve({
        rows: correlatedPaymentId ? [{ payment_id: correlatedPaymentId }] : [],
        rowCount: correlatedPaymentId ? 1 : 0,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  // Which table `from(...)` was given, read off Drizzle's name symbol, so
  // the wallet lookup and the vault lookup return different rows.
  const tableName = (table: unknown): string | null => {
    if (typeof table !== 'object' || table === null) return null;
    const v = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
    return typeof v === 'string' ? v : null;
  };

  const makeSelect = () => {
    // The controller's downstream `addrToAccount.has(...)` already
    // restricts which rows lead to UPSERTs. The fake returns the full
    // owned set for the table asked about; tests assert on the
    // controller's effects.
    let table: string | null = null;
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        table = tableName(t);
        return chain;
      },
      innerJoin: () => chain,
      where: () => chain,
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) =>
        Promise.resolve(
          table === 'squads_accounts'
            ? ownedVaults.slice()
            : ownedAccounts.slice(),
        ).then(resolve, reject),
    };
    return chain;
  };
  const client = {
    execute,
    select: () => makeSelect(),
  };
  return { db: { client } as unknown as DbService, calls };
}

function makeFakeSolana(overrides: Partial<SolanaRpc> = {}): SolanaRpc {
  return {
    getRecentBlockhash: jest.fn(),
    getSolBalance: jest.fn().mockResolvedValue(0n),
    getTokenBalances: jest.fn(),
    sendRawTransaction: jest.fn(),
    getSignatureStatuses: jest.fn(),
    accountExists: jest.fn(),
    getMinimumBalanceForRentExemption: jest.fn(),
    getTokenAccountOwner: jest.fn(),
    getTokenAccountBalanceRaw: jest.fn(),
    streamConfirmedTransfers: jest.fn(),
    registerWebhookAddress: jest.fn(),
    unregisterWebhookAddress: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    ...overrides,
  };
}

const OWNED_WALLET = 'OWNERWaLLeT1111111111111111111111111111111';
const SENDER_WALLET = 'SENDeR2222222222222222222222222222222222222';

const sampleHeliusBody: HeliusWebhookBody = [
  {
    signature: 'sig-1',
    slot: 12345,
    timestamp: 1717090000, // 2024-05-30 ish
    type: 'TRANSFER',
    source: 'SYSTEM_PROGRAM',
    transactionError: null,
    tokenTransfers: [
      {
        fromUserAccount: SENDER_WALLET,
        toUserAccount: OWNED_WALLET,
        mint: 'USDC11111111111111111111111111111111111111',
        tokenAmount: 1.5,
        rawTokenAmount: { tokenAmount: '1500000', decimals: 6 },
      },
    ],
  },
];

// ── TailerService unit ────────────────────────────────────────────────

describe('TailerService.upsertConfirmedTransfer', () => {
  it('issues the status-guarded UPSERT for the incoming event', async () => {
    const { db, calls } = makeFakeDb();
    const tailer = new TailerService(
      db,
      fakePriceProvider(),
      fakeNotifications(),
      fakeNamer(),
    );
    const evt: ConfirmedTransferEvent = {
      signature: 'sig-1',
      slot: 999n,
      mint: 'USDC',
      amountRaw: 1_000_000n,
      decimals: 6,
      fromAddress: SENDER_WALLET,
      toAddress: OWNED_WALLET,
      confirmedAt: new Date(),
    };

    const direction = await tailer.upsertConfirmedTransfer(
      evt,
      'sa_test',
      OWNED_WALLET,
    );

    expect(direction).toBe('RECEIVE');
    // 3 executes: correlation SELECT, transfers UPSERT, tailer_state UPSERT.
    expect(calls).toHaveLength(3);
    // The correlation lookup joins payments by signature.
    expect(calls[0].sql).toMatch(/payment_attempts/);
    expect(calls[0].sql).toMatch(/JOIN payments/);
    // The transfers UPSERT carries the status guard CASE clause.
    expect(calls[1].sql).toMatch(/INSERT INTO transfers/);
    expect(calls[1].sql).toMatch(/ON CONFLICT/);
    expect(calls[1].sql).toMatch(/CASE/);
    expect(calls[1].sql).toMatch(/CONFIRMED.*FAILED/);
    // tailer_state UPSERT uses GREATEST to never regress the bookmark.
    expect(calls[2].sql).toMatch(/INSERT INTO tailer_state/);
    expect(calls[2].sql).toMatch(/GREATEST/);
  });

  it("correlates a confirmed transfer to a Payment (kind='payment' + payment_id) when the signature matches", async () => {
    const { db, calls } = makeFakeDb([], 'pay_123');
    const tailer = new TailerService(
      db,
      fakePriceProvider(),
      fakeNotifications(),
      fakeNamer(),
    );
    const evt: ConfirmedTransferEvent = {
      signature: 'sig-pay',
      slot: 42n,
      mint: 'USDC',
      amountRaw: 1_000_000n,
      decimals: 6,
      fromAddress: SENDER_WALLET,
      toAddress: OWNED_WALLET,
      confirmedAt: new Date(),
    };
    await tailer.upsertConfirmedTransfer(evt, 'sa_test', OWNED_WALLET);
    // The transfers INSERT carries the payment linkage param.
    expect(calls[1].sql).toContain('pay_123');
  });

  it("leaves a transfer with no matching payment as kind='transfer'", async () => {
    const { db, calls } = makeFakeDb([]);
    const tailer = new TailerService(
      db,
      fakePriceProvider(),
      fakeNotifications(),
      fakeNamer(),
    );
    const evt: ConfirmedTransferEvent = {
      signature: 'sig-plain',
      slot: 43n,
      mint: 'USDC',
      amountRaw: 1_000_000n,
      decimals: 6,
      fromAddress: SENDER_WALLET,
      toAddress: OWNED_WALLET,
      confirmedAt: new Date(),
    };
    await tailer.upsertConfirmedTransfer(evt, 'sa_test', OWNED_WALLET);
    // No payment id embedded; the row stays a plain transfer.
    expect(calls[1].sql).not.toContain('pay_');
  });

  it('assigns SEND when ownedWallet is the sender', async () => {
    const { db } = makeFakeDb();
    const tailer = new TailerService(
      db,
      fakePriceProvider(),
      fakeNotifications(),
      fakeNamer(),
    );
    const evt: ConfirmedTransferEvent = {
      signature: 'sig-out',
      slot: 1000n,
      mint: 'USDC',
      amountRaw: 5_000_000n,
      decimals: 6,
      fromAddress: OWNED_WALLET,
      toAddress: SENDER_WALLET,
      confirmedAt: new Date(),
    };
    const direction = await tailer.upsertConfirmedTransfer(
      evt,
      'sa_test',
      OWNED_WALLET,
    );
    expect(direction).toBe('SEND');
  });
});

// ── EventParser unit ──────────────────────────────────────────────────

describe('TailerService USD valuation', () => {
  const SOL = 'So11111111111111111111111111111111111111112';

  it('stamps what the transfer was worth at the moment it was indexed', async () => {
    const { db, calls } = makeFakeDb();
    const tailer = new TailerService(
      db,
      fakePriceProvider({ [SOL]: { usdPrice: 100, decimals: 9 } }),
      fakeNotifications(),
      fakeNamer(),
    );

    await tailer.upsertConfirmedTransfer(
      {
        signature: 'sig-sol',
        slot: 1n,
        mint: SOL,
        amountRaw: 5_000_000_000n,
        decimals: 9,
        fromAddress: SENDER_WALLET,
        toAddress: OWNED_WALLET,
        confirmedAt: new Date(),
      },
      'sa_1',
      OWNED_WALLET,
    );

    // 5 SOL at $100 is $500, and that is what gets written.
    const insert = calls.find((c) => c.sql.includes('INSERT INTO transfers'));
    expect(insert?.sql).toContain('500.000000');
  });

  it('never re-prices a row a later delivery touches again', async () => {
    const { db, calls } = makeFakeDb();
    const tailer = new TailerService(
      db,
      fakePriceProvider({ [SOL]: { usdPrice: 100, decimals: 9 } }),
      fakeNotifications(),
      fakeNamer(),
    );

    await tailer.upsertConfirmedTransfer(
      {
        signature: 'sig-sol',
        slot: 1n,
        mint: SOL,
        amountRaw: 5_000_000_000n,
        decimals: 9,
        fromAddress: SENDER_WALLET,
        toAddress: OWNED_WALLET,
        confirmedAt: new Date(),
      },
      'sa_1',
      OWNED_WALLET,
    );

    // The stored value survives the market moving, because the conflict
    // clause keeps the first stamp rather than the incoming one.
    const insert = calls.find((c) => c.sql.includes('INSERT INTO transfers'));
    expect(insert?.sql).toContain(
      'usd_value = COALESCE(transfers.usd_value, EXCLUDED.usd_value)',
    );
  });

  it('writes the transfer anyway when nothing can price the mint', async () => {
    const { db, calls } = makeFakeDb();
    const tailer = new TailerService(
      db,
      fakePriceProvider(),
      fakeNotifications(),
      fakeNamer(),
    );

    const direction = await tailer.upsertConfirmedTransfer(
      {
        signature: 'sig-unpriced',
        slot: 1n,
        mint: 'UnpriceableMint',
        amountRaw: 1n,
        decimals: 6,
        fromAddress: SENDER_WALLET,
        toAddress: OWNED_WALLET,
        confirmedAt: new Date(),
      },
      'sa_1',
      OWNED_WALLET,
    );

    // The row is the point; the valuation is decoration on top of it.
    expect(direction).toBe('RECEIVE');
    expect(calls.some((c) => c.sql.includes('INSERT INTO transfers'))).toBe(
      true,
    );
  });
});

describe('TailerService arrival notices', () => {
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  const arrival = (over: Record<string, unknown> = {}) => ({
    signature: 'sig-arrival',
    slot: 1n,
    mint: SOL_MINT,
    amountRaw: 5_000_000_000n,
    decimals: 9,
    fromAddress: SENDER_WALLET,
    toAddress: OWNED_WALLET,
    confirmedAt: new Date(),
    ...over,
  });

  it('announces a new arrival in the Consumer terms', async () => {
    const { db } = makeFakeDb();
    const notifications = fakeNotifications();
    const tailer = new TailerService(
      db,
      fakePriceProvider(),
      notifications,
      fakeNamer(),
    );

    await tailer.upsertConfirmedTransfer(arrival(), 'sa_1', OWNED_WALLET);

    expect(notifications.notifyArrival).toHaveBeenCalledWith({
      smartAccountId: 'sa_1',
      amount: '5 SOL',
    });
  });

  it('names the token, not only SOL', async () => {
    // The tailer used to answer "SOL" or nothing at all, so a USDC arrival
    // announced itself as "You received 10" with no ticker on it.
    const USDC = 'UsdcMint00000000000000000000000000000000000';
    const { db } = makeFakeDb();
    const notifications = fakeNotifications();
    const namer = {
      symbolFor: jest.fn().mockResolvedValue('USDC'),
    } as unknown as TokenNamer;
    const tailer = new TailerService(
      db,
      fakePriceProvider(),
      notifications,
      namer,
    );

    await tailer.upsertConfirmedTransfer(
      arrival({ mint: USDC, amountRaw: 10_000_000n, decimals: 6 }),
      'sa_1',
      OWNED_WALLET,
    );

    expect(notifications.notifyArrival).toHaveBeenCalledWith({
      smartAccountId: 'sa_1',
      amount: '10 USDC',
    });
  });

  it('announces the amount alone when nothing can name the mint', async () => {
    const { db } = makeFakeDb();
    const notifications = fakeNotifications();
    const tailer = new TailerService(db, fakePriceProvider(), notifications, {
      symbolFor: jest.fn().mockResolvedValue(''),
    } as unknown as TokenNamer);

    await tailer.upsertConfirmedTransfer(
      arrival({ mint: 'UnknownMint', amountRaw: 1_500_000n, decimals: 6 }),
      'sa_1',
      OWNED_WALLET,
    );

    expect(notifications.notifyArrival).toHaveBeenCalledWith({
      smartAccountId: 'sa_1',
      amount: '1.5',
    });
  });

  it("values a transfer from the chain's decimals when the quote omits them", async () => {
    // The quote can legitimately answer with a price and no decimals. Refusing
    // to value the row then left it permanently unvalued, even though the
    // event itself carried the authoritative scale.
    const { db, calls } = makeFakeDb();
    const tailer = new TailerService(
      db,
      fakePriceProvider({ [SOL_MINT]: { usdPrice: 100, decimals: null } }),
      fakeNotifications(),
      fakeNamer(),
    );

    await tailer.upsertConfirmedTransfer(
      arrival({ decimals: 9 }),
      'sa_1',
      OWNED_WALLET,
    );

    const insert = calls.find((c) => c.sql.includes('INSERT INTO transfers'));
    expect(insert?.sql).toContain('500.000000');
  });

  it('says nothing when the same signature is delivered again', async () => {
    // A webhook redelivery and a replay both re-run this upsert. Announcing on
    // the conflict path would tell the Consumer twice about one payment.
    const { db } = makeFakeDb([], undefined, [], false);
    const notifications = fakeNotifications();
    const tailer = new TailerService(
      db,
      fakePriceProvider(),
      notifications,
      fakeNamer(),
    );

    await tailer.upsertConfirmedTransfer(arrival(), 'sa_1', OWNED_WALLET);

    expect(notifications.notifyArrival).not.toHaveBeenCalled();
  });

  it('says nothing about money the Consumer sent themselves', async () => {
    const { db } = makeFakeDb();
    const notifications = fakeNotifications();
    const tailer = new TailerService(
      db,
      fakePriceProvider(),
      notifications,
      fakeNamer(),
    );

    await tailer.upsertConfirmedTransfer(
      arrival({ fromAddress: OWNED_WALLET, toAddress: SENDER_WALLET }),
      'sa_1',
      OWNED_WALLET,
    );

    expect(notifications.notifyArrival).not.toHaveBeenCalled();
  });

  it('still writes the transfer when the announcement fails', async () => {
    const { db, calls } = makeFakeDb();
    const notifications = {
      notifyArrival: jest.fn().mockRejectedValue(new Error('push down')),
    } as unknown as NotificationsService;
    const tailer = new TailerService(
      db,
      fakePriceProvider(),
      notifications,
      fakeNamer(),
    );

    await expect(
      tailer.upsertConfirmedTransfer(arrival(), 'sa_1', OWNED_WALLET),
    ).resolves.toBe('RECEIVE');
    expect(calls.some((c) => c.sql.includes('INSERT INTO transfers'))).toBe(
      true,
    );
  });
});

describe('EventParser.parseDecoded', () => {
  const parser = new EventParser();

  it('projects a native SOL transfer onto the wrapped-SOL mint', () => {
    const events = parser.parseDecoded([
      {
        signature: 'sig-native',
        slot: 42,
        timestamp: 1717090000,
        transactionError: null,
        nativeTransfers: [
          {
            fromUserAccount: SENDER_WALLET,
            toUserAccount: OWNED_WALLET,
            amount: 5_000_000_000,
          },
        ],
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      // The same mint the balance read uses, so one holding is one asset.
      mint: 'So11111111111111111111111111111111111111112',
      amountRaw: 5_000_000_000n,
      decimals: 9,
      fromAddress: SENDER_WALLET,
      toAddress: OWNED_WALLET,
    });
  });

  it('reads token and native transfers from the same transaction', () => {
    const events = parser.parseDecoded([
      {
        signature: 'sig-both',
        slot: 43,
        timestamp: 1717090000,
        transactionError: null,
        tokenTransfers: [
          {
            fromUserAccount: SENDER_WALLET,
            toUserAccount: OWNED_WALLET,
            mint: 'USDC11111111111111111111111111111111111111',
            tokenAmount: 1.5,
            rawTokenAmount: { tokenAmount: '1500000', decimals: 6 },
          },
        ],
        nativeTransfers: [
          {
            fromUserAccount: SENDER_WALLET,
            toUserAccount: OWNED_WALLET,
            amount: 1_000_000,
          },
        ],
      },
    ]);

    expect(events.map((e) => e.mint)).toEqual([
      'USDC11111111111111111111111111111111111111',
      'So11111111111111111111111111111111111111112',
    ]);
  });

  it('projects a Helius transaction into ConfirmedTransferEvent[]', () => {
    const events = parser.parseDecoded(sampleHeliusBody);
    expect(events).toHaveLength(1);
    expect(events[0].signature).toBe('sig-1');
    expect(events[0].slot).toBe(12345n);
    expect(events[0].amountRaw).toBe(1_500_000n);
    expect(events[0].fromAddress).toBe(SENDER_WALLET);
    expect(events[0].toAddress).toBe(OWNED_WALLET);
  });

  it('drops transactions with transactionError set', () => {
    const events = parser.parseDecoded([
      { ...sampleHeliusBody[0], transactionError: { InstructionError: [] } },
    ]);
    expect(events).toEqual([]);
  });

  it('returns [] on non-array body (defensive)', () => {
    expect(
      parser.parseDecoded(undefined as unknown as HeliusWebhookBody),
    ).toEqual([]);
    expect(parser.parseDecoded(null as unknown as HeliusWebhookBody)).toEqual(
      [],
    );
  });

  it('skips tokenTransfers with no from/to user accounts', () => {
    const events = parser.parseDecoded([
      {
        ...sampleHeliusBody[0],
        tokenTransfers: [
          {
            fromUserAccount: null,
            toUserAccount: OWNED_WALLET,
            mint: 'm',
            tokenAmount: 1,
            rawTokenAmount: { tokenAmount: '1000000', decimals: 6 },
          },
        ],
      },
    ]);
    expect(events).toEqual([]);
  });

  it('reconstructs amountRaw from float when rawTokenAmount missing', () => {
    const events = parser.parseDecoded([
      {
        signature: 'sig-float',
        slot: 1,
        timestamp: 1717090000,
        transactionError: null,
        tokenTransfers: [
          {
            fromUserAccount: SENDER_WALLET,
            toUserAccount: OWNED_WALLET,
            mint: 'm',
            tokenAmount: 2.5,
            // no rawTokenAmount; default 6 decimals
          },
        ],
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].amountRaw).toBe(2_500_000n);
  });
});

// ── WebhookController integration ────────────────────────────────────

function makeController(opts: {
  ownedAccounts?: SmartAccountRow[];
  ownedVaults?: SmartAccountRow[];
  verify?: SolanaRpc['verifyWebhookSignature'];
}): {
  controller: WebhookController;
  calls: FakeDbCall[];
  solana: SolanaRpc;
} {
  const { db, calls } = makeFakeDb(
    opts.ownedAccounts ?? [],
    undefined,
    opts.ownedVaults ?? [],
  );
  const solana = makeFakeSolana(
    opts.verify ? { verifyWebhookSignature: opts.verify } : {},
  );
  const tailer = new TailerService(
    db,
    fakePriceProvider(),
    fakeNotifications(),
    fakeNamer(),
  );
  const parser = new EventParser();
  const reconciler = {
    recordWebhookFinalization: jest.fn(),
  } as unknown as import('./reconciler.service').ReconcilerService;
  const controller = new WebhookController(
    db,
    tailer,
    parser,
    solana,
    reconciler,
  );
  return { controller, calls, solana };
}

describe('WebhookController POST /webhooks/helius', () => {
  beforeEach(() => {
    delete process.env.ACTIVITY_WEBHOOK_KILLSWITCH;
  });

  it('writes CONFIRMED row when valid HMAC + matching wallet', async () => {
    const { controller, calls } = makeController({
      ownedAccounts: [{ id: 'sa_1', walletAddress: OWNED_WALLET }],
    });
    const req = {
      rawBody: Buffer.from(JSON.stringify(sampleHeliusBody)),
    } as unknown;

    const res = await controller.receive(
      req,
      'auth-header',
      'sig-header',
      sampleHeliusBody,
    );

    expect(res.processed).toBe(1);
    expect(res.skipped).toBe(0);
    // 3 execute() calls: correlation SELECT, transfers UPSERT, tailer_state UPSERT.
    expect(calls).toHaveLength(3);
    expect(calls[1].sql).toMatch(/INSERT INTO transfers/);
    expect(calls[1].sql).toMatch(/CASE/);
  });

  it('records a deposit that only touches the vault address', async () => {
    // The vault is where a Consumer is told to receive, and it appears in no
    // smart_accounts row, so resolving owners from that table alone dismissed
    // every deposit as somebody else's traffic.
    const { controller, calls } = makeController({
      ownedAccounts: [],
      ownedVaults: [{ id: 'sa_owner', walletAddress: OWNED_WALLET }],
    });
    const req = {
      rawBody: Buffer.from(JSON.stringify(sampleHeliusBody)),
    } as unknown;

    const res = await controller.receive(
      req,
      'auth-header',
      'sig-header',
      sampleHeliusBody,
    );

    expect(res.processed).toBe(1);
    expect(res.skipped).toBe(0);
    expect(calls[1].sql).toMatch(/INSERT INTO transfers/);
  });

  it('records a native SOL transfer, which carries no token account', async () => {
    // Native SOL moves through the System Program, so it never appears in
    // tokenTransfers. Ignoring nativeTransfers left a Consumer's SOL visible
    // in their balance but absent from their activity.
    const nativeBody: HeliusWebhookBody = [
      {
        signature: 'sig-native-1',
        slot: 999,
        timestamp: 1717090000,
        type: 'TRANSFER',
        source: 'SYSTEM_PROGRAM',
        transactionError: null,
        nativeTransfers: [
          {
            fromUserAccount: SENDER_WALLET,
            toUserAccount: OWNED_WALLET,
            amount: 5_000_000_000,
          },
        ],
      },
    ];
    const { controller, calls } = makeController({
      ownedAccounts: [{ id: 'sa_1', walletAddress: OWNED_WALLET }],
    });
    const req = { rawBody: Buffer.from(JSON.stringify(nativeBody)) } as unknown;

    const res = await controller.receive(
      req,
      'auth-header',
      'sig-header',
      nativeBody,
    );

    expect(res.processed).toBe(1);
    expect(res.skipped).toBe(0);
    // Reported under the wrapped-SOL mint, matching the balance read.
    expect(calls[1].sql).toMatch(/INSERT INTO transfers/);
  });

  it('returns 401 (HttpException UNAUTHORIZED) when HMAC fails; no DB writes', async () => {
    const { controller, calls } = makeController({
      ownedAccounts: [{ id: 'sa_1', walletAddress: OWNED_WALLET }],
      verify: jest.fn(() => {
        throw new HttpException(
          { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'bad' },
          HttpStatus.UNAUTHORIZED,
        );
      }),
    });
    const req = {
      rawBody: Buffer.from(JSON.stringify(sampleHeliusBody)),
    } as unknown;

    await expect(
      controller.receive(req, 'bad', 'bad', sampleHeliusBody),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { code: 'INVALID_WEBHOOK_SIGNATURE' },
    });
    expect(calls).toHaveLength(0);
  });

  it('skips events for unknown wallets without DB writes', async () => {
    // No ownedAccounts seeded — the event's wallets do not match.
    const { controller, calls } = makeController({
      ownedAccounts: [],
    });
    const req = {
      rawBody: Buffer.from(JSON.stringify(sampleHeliusBody)),
    } as unknown;

    const res = await controller.receive(
      req,
      'auth-header',
      '',
      sampleHeliusBody,
    );

    expect(res.processed).toBe(0);
    expect(res.skipped).toBe(1);
    expect(calls).toHaveLength(0); // no UPSERT
  });

  it('killSwitch acks delivery without parsing or writing', async () => {
    process.env.ACTIVITY_WEBHOOK_KILLSWITCH = '1';
    const { controller, calls, solana } = makeController({
      ownedAccounts: [{ id: 'sa_1', walletAddress: OWNED_WALLET }],
    });
    const req = {
      rawBody: Buffer.from(JSON.stringify(sampleHeliusBody)),
    } as unknown;

    const res = await controller.receive(
      req,
      'auth-header',
      '',
      sampleHeliusBody,
    );

    expect(res).toEqual({ processed: 0, skipped: 1, killSwitched: true });
    expect(calls).toHaveLength(0);

    expect(solana.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it('duplicate webhook deliveries are idempotent (relies on ON CONFLICT)', async () => {
    // We call receive() twice with the same body. The fake db.execute
    // tracks call shapes, but the ON CONFLICT semantics live in the
    // SQL string we issue — both calls land the same status-guarded
    // UPSERT, so a real DB collapses them via UNIQUE(signature).
    const { controller, calls } = makeController({
      ownedAccounts: [{ id: 'sa_1', walletAddress: OWNED_WALLET }],
    });
    const req = {
      rawBody: Buffer.from(JSON.stringify(sampleHeliusBody)),
    } as unknown;

    await controller.receive(req, 'auth-header', '', sampleHeliusBody);
    await controller.receive(req, 'auth-header', '', sampleHeliusBody);

    // 2 deliveries × 3 statements each (correlation SELECT + transfers UPSERT
    // + tailer_state UPSERT) = 6 calls. The two UPSERTs per delivery carry the
    // ON CONFLICT clause, so a real DB collapses them to a single row.
    expect(calls).toHaveLength(6);
    expect(calls.filter((c) => /ON CONFLICT/.test(c.sql))).toHaveLength(4);
  });

  it('CONFIRMED row not regressed to PENDING by late webhook (status guard SQL)', async () => {
    // Status guard correctness is encoded in the SQL we emit; assert
    // the CASE clause shape.
    const { controller, calls } = makeController({
      ownedAccounts: [{ id: 'sa_1', walletAddress: OWNED_WALLET }],
    });
    const req = {
      rawBody: Buffer.from(JSON.stringify(sampleHeliusBody)),
    } as unknown;

    await controller.receive(req, 'auth-header', '', sampleHeliusBody);
    const upsertSql = calls.find((c) => /INSERT INTO transfers/.test(c.sql));
    expect(upsertSql).toBeDefined();
    // Required tokens for the guard:
    //   "CASE WHEN ... CONFIRMED ... FAILED ... THEN ... ELSE EXCLUDED ..."
    expect(upsertSql!.sql).toMatch(/CASE/);
    expect(upsertSql!.sql).toMatch(/CONFIRMED/);
    expect(upsertSql!.sql).toMatch(/FAILED/);
    expect(upsertSql!.sql).toMatch(/EXCLUDED/);
  });
});
