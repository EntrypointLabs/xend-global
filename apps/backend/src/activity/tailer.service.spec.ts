import { TailerService } from './tailer.service';
import { EventParser, HeliusWebhookBody } from './event-parser';
import { WebhookController } from './webhook.controller';
import type { DbService } from '../db/db.service';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { ConfirmedTransferEvent } from '../solana/solana-rpc.interface';
import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Tests for TailerService + WebhookController + EventParser, covering
 * the PLAN.md Phase 2 unit-test test plan rows:
 *
 *   * Webhook with valid HMAC + matching wallet writes CONFIRMED row.
 *   * Webhook with bad HMAC returns 401, no DB writes.
 *   * Event for unknown wallet is skipped (no DB writes).
 *   * Duplicate signature webhook is idempotent (ON CONFLICT).
 *   * CONFIRMED row NOT regressed to PENDING by late webhook.
 *
 * The DbService is faked: db.client.execute() is a jest.fn that
 * records sql template literals so we can assert on call counts +
 * presence of the status-guard CASE clause without booting Postgres.
 * The status-guard SQL behaviour itself is exercised end-to-end in
 * the Task 2.3 devnet verification scenarios.
 */

interface FakeDbCall {
  sql: string;
  params: unknown[];
}

interface SmartAccountRow {
  id: string;
  walletAddress: string;
}

function makeFakeDb(ownedAccounts: SmartAccountRow[] = []): {
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
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  const makeSelect = () => {
    // The controller's downstream `addrToAccount.has(...)` already
    // restricts which rows lead to UPSERTs. The fake returns the full
    // owned-account set; tests assert on the controller's effects.
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(ownedAccounts.slice()).then(resolve, reject),
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
    getTokenBalances: jest.fn(),
    sendRawTransaction: jest.fn(),
    getSignatureStatuses: jest.fn(),
    accountExists: jest.fn(),
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
    const tailer = new TailerService(db);
    const evt: ConfirmedTransferEvent = {
      signature: 'sig-1',
      slot: 999n,
      mint: 'USDC',
      amountRaw: 1_000_000n,
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
    // 2 executes: one for transfers UPSERT, one for tailer_state UPSERT.
    expect(calls).toHaveLength(2);
    // The transfers UPSERT carries the status guard CASE clause.
    expect(calls[0].sql).toMatch(/INSERT INTO transfers/);
    expect(calls[0].sql).toMatch(/ON CONFLICT/);
    expect(calls[0].sql).toMatch(/CASE/);
    expect(calls[0].sql).toMatch(/CONFIRMED.*FAILED/);
    // tailer_state UPSERT uses GREATEST to never regress the bookmark.
    expect(calls[1].sql).toMatch(/INSERT INTO tailer_state/);
    expect(calls[1].sql).toMatch(/GREATEST/);
  });

  it('assigns SEND when ownedWallet is the sender', async () => {
    const { db } = makeFakeDb();
    const tailer = new TailerService(db);
    const evt: ConfirmedTransferEvent = {
      signature: 'sig-out',
      slot: 1000n,
      mint: 'USDC',
      amountRaw: 5_000_000n,
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

describe('EventParser.parseDecoded', () => {
  const parser = new EventParser();

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
  verify?: SolanaRpc['verifyWebhookSignature'];
}): {
  controller: WebhookController;
  calls: FakeDbCall[];
  solana: SolanaRpc;
} {
  const { db, calls } = makeFakeDb(opts.ownedAccounts ?? []);
  const solana = makeFakeSolana(
    opts.verify ? { verifyWebhookSignature: opts.verify } : {},
  );
  const tailer = new TailerService(db);
  const parser = new EventParser();
  const controller = new WebhookController(db, tailer, parser, solana);
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
    // 2 execute() calls: transfers UPSERT + tailer_state UPSERT.
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toMatch(/INSERT INTO transfers/);
    expect(calls[0].sql).toMatch(/CASE/);
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
    // eslint-disable-next-line @typescript-eslint/unbound-method
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

    // 2 deliveries × 2 statements each = 4 calls. All four contain the
    // ON CONFLICT clause, so a real DB collapses them to a single row.
    expect(calls).toHaveLength(4);
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
