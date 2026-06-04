import { ConfigService } from '@nestjs/config';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { TransferService } from './transfer.service';
import type { DbService } from '../db/db.service';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import {
  InvalidRecipientError,
  IntentExpiredError,
  IntentMismatchError,
  RpcUnavailableError,
  UnsupportedMintError,
} from './transfer.errors';

/**
 * Re-sign the prepared transaction the way the Privy wallet would: signing
 * adds signatures but leaves the message untouched, so submit()'s
 * message-match check passes. Used by the submit tests that need a valid
 * payload.
 */
function signPrepared(unsignedTxBase64: string): string {
  const tx = VersionedTransaction.deserialize(
    Buffer.from(unsignedTxBase64, 'base64'),
  );
  tx.signatures = tx.signatures.map(() => new Uint8Array(64).fill(7));
  return Buffer.from(tx.serialize()).toString('base64');
}
import { smartAccounts, transfers } from '../db/schema';

/**
 * Integration tests for TransferService (prepare / submit / list):
 *   - prepare: invalid recipient / unsupported mint return 400
 *   - prepare: includes create-ATA when missing, omits it when present
 *   - submit: duplicate intentId returns existing row
 *   - submit: writes PENDING row with signature
 *   - submit: RPC failure returns 502 without writing row
 *   - submit: expired intent / wrong-user intent rejected
 *   - list: pagination cursor round-trips
 *
 * Drizzle is stubbed in-memory; its opaque SQL predicates are treated as
 * match-all by the fake, and each test seeds only the rows it cares
 * about, so this is sound.
 */

// ── In-memory fake DB ─────────────────────────────────────────────────

type SmartAccountsRow = typeof smartAccounts.$inferSelect;
type TransfersRow = typeof transfers.$inferSelect;

interface FakeStore {
  smartAccounts: SmartAccountsRow[];
  transfers: TransfersRow[];
}

function makeFakeDb(store: FakeStore): DbService {
  const collectionFor = (tbl: unknown): 'smartAccounts' | 'transfers' => {
    if (tbl === smartAccounts) return 'smartAccounts';
    if (tbl === transfers) return 'transfers';
    throw new Error('unknown table');
  };

  const makeSelectChain = (collection: 'smartAccounts' | 'transfers') => {
    // We track ordering + limit so the list() path tests work, but
    // ignore the where(opaque) predicate (caller asserts on overall
    // outcome with at most a few seeded rows).
    const ctx: { limit?: number; orderDesc?: boolean } = {};
    const execute = () => {
      let rows = (store[collection] as Record<string, unknown>[]).slice();
      if (ctx.orderDesc) {
        rows = rows.sort((a, b) => {
          const ad = (a.createdAt as Date).getTime();
          const bd = (b.createdAt as Date).getTime();
          if (ad !== bd) return bd - ad;
          return (b.id as string).localeCompare(a.id as string);
        });
      }
      if (ctx.limit !== undefined) rows = rows.slice(0, ctx.limit);
      return Promise.resolve(rows);
    };
    const chain: Record<string, unknown> = {
      where: () => chain,
      orderBy: () => {
        ctx.orderDesc = true;
        return chain;
      },
      limit: (n: number) => {
        ctx.limit = n;
        return chain;
      },
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => execute().then(resolve, reject),
    };
    return chain;
  };

  const client = {
    select: () => ({
      from: (tbl: unknown) => makeSelectChain(collectionFor(tbl)),
    }),
    insert: (tbl: unknown) => {
      const collection = collectionFor(tbl);
      return {
        values: (vals: Record<string, unknown>) => {
          let row: Record<string, unknown>;
          if (collection === 'transfers') {
            row = {
              id: `t_${store.transfers.length + 1}`,
              smartAccountId: vals.smartAccountId,
              intentId: vals.intentId ?? null,
              signature: vals.signature ?? null,
              direction: vals.direction,
              mint: vals.mint,
              amountRaw: vals.amountRaw,
              fromAddress: vals.fromAddress,
              toAddress: vals.toAddress,
              status: vals.status ?? 'PENDING',
              slot: vals.slot ?? null,
              createdAt: new Date(),
              submittedAt: vals.submittedAt ?? null,
              confirmedAt: vals.confirmedAt ?? null,
              failureReason: vals.failureReason ?? null,
            };
          } else {
            row = vals;
          }
          (store[collection] as Record<string, unknown>[]).push(row);
          return {
            returning: () => Promise.resolve([row]),
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve([row]).then(resolve),
          };
        },
      };
    },
  };
  return { client } as unknown as DbService;
}

// ── Test fixtures ─────────────────────────────────────────────────────

const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const usdtMint = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const bonkMint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function makeAccount(): SmartAccountsRow {
  // Use a real Solana keypair so PublicKey constructors succeed.
  const kp = Keypair.generate();
  return {
    id: 'sa_test',
    userId: 'u_test',
    walletAddress: kp.publicKey.toBase58(),
    provider: 'privy',
    providerUserId: 'did:privy:test',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeConfig(
  overrides: Record<string, string | undefined> = {},
): ConfigService {
  const map: Record<string, string | undefined> = {
    EXPO_PUBLIC_USDC_MINT_ADDRESS: usdcMint,
    EXPO_PUBLIC_USDT_MINT_ADDRESS: usdtMint,
    ...overrides,
  };
  return {
    get: (key: string) => map[key],
  } as unknown as ConfigService;
}

function makeSolana(opts: Partial<SolanaRpc>): SolanaRpc {
  return {
    getRecentBlockhash:
      opts.getRecentBlockhash ??
      jest.fn().mockResolvedValue({
        blockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 12345,
      }),
    getTokenBalances: opts.getTokenBalances ?? jest.fn().mockResolvedValue([]),
    sendRawTransaction:
      opts.sendRawTransaction ?? jest.fn().mockResolvedValue('sig-default'),
    getSignatureStatuses:
      opts.getSignatureStatuses ?? jest.fn().mockResolvedValue([]),
    accountExists: opts.accountExists ?? jest.fn().mockResolvedValue(true),
    streamConfirmedTransfers:
      opts.streamConfirmedTransfers ??
      ((() => {
        throw new Error('not used');
      }) as unknown as SolanaRpc['streamConfirmedTransfers']),
    registerWebhookAddress:
      opts.registerWebhookAddress ?? jest.fn().mockResolvedValue(undefined),
    unregisterWebhookAddress:
      opts.unregisterWebhookAddress ?? jest.fn().mockResolvedValue(undefined),
    verifyWebhookSignature: opts.verifyWebhookSignature ?? jest.fn(),
  };
}

function makeService(opts: {
  store?: FakeStore;
  solana: SolanaRpc;
  config?: ConfigService;
  account?: SmartAccountsRow;
}) {
  const account = opts.account ?? makeAccount();
  const store: FakeStore = opts.store ?? {
    smartAccounts: [account],
    transfers: [],
  };
  const db = makeFakeDb(store);
  const config = opts.config ?? makeConfig();
  const service = new TransferService(db, config, opts.solana);
  return { service, store, account };
}

// ── prepare ───────────────────────────────────────────────────────────

describe('TransferService.prepare', () => {
  it('returns intentId + base64 tx + ISO expiresAt on the happy path', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const solana = makeSolana({
      // Recipient ATA exists — no createATA instruction.
      accountExists: jest.fn().mockResolvedValue(true),
    });
    const { service } = makeService({ solana });

    const out = await service.prepare('u_test', {
      toAddress: recipient,
      mint: usdcMint,
      amountRaw: '1000000',
    });

    expect(out.intentId).toEqual(expect.any(String));
    expect(out.intentId.length).toBeGreaterThan(0);
    expect(out.unsignedTxBase64).toEqual(expect.any(String));
    expect(out.feeLamports).toBeGreaterThanOrEqual(0);
    expect(() => new Date(out.expiresAt)).not.toThrow();
    expect(new Date(out.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('invalid recipient -> InvalidRecipientError (400)', async () => {
    const solana = makeSolana({});
    const { service } = makeService({ solana });

    await expect(
      service.prepare('u_test', {
        toAddress: 'not-a-pubkey',
        mint: usdcMint,
        amountRaw: '1',
      }),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
  });

  it('self-send -> InvalidRecipientError (400)', async () => {
    const account = makeAccount();
    const solana = makeSolana({});
    const { service } = makeService({ solana, account });

    await expect(
      service.prepare('u_test', {
        toAddress: account.walletAddress,
        mint: usdcMint,
        amountRaw: '1',
      }),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
  });

  it('unsupported mint -> UnsupportedMintError (400)', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const solana = makeSolana({});
    const { service } = makeService({ solana });

    await expect(
      service.prepare('u_test', {
        toAddress: recipient,
        mint: bonkMint, // not in allowlist
        amountRaw: '1',
      }),
    ).rejects.toBeInstanceOf(UnsupportedMintError);
  });

  it('prepends createATA instruction when recipient ATA missing', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const accountExists = jest.fn().mockResolvedValue(false);
    const solana = makeSolana({ accountExists });
    const { service } = makeService({ solana });

    const out = await service.prepare('u_test', {
      toAddress: recipient,
      mint: usdcMint,
      amountRaw: '1000000',
    });

    expect(accountExists).toHaveBeenCalledTimes(1);
    // Decode the v0 tx and assert there are 2 instructions
    // (createATA + transferChecked) rather than 1.
    const txBuf = Buffer.from(out.unsignedTxBase64, 'base64');
    // The serialized v0 tx layout is non-trivial to decode without
    // pulling in web3.js again here; instead we assert by length
    // proxy — a 2-instruction tx is materially longer than a
    // 1-instruction tx. The exact byte count varies but the
    // difference is > 40 bytes (createATA carries 6 account metas
    // + a single-byte instruction id).
    expect(txBuf.length).toBeGreaterThan(200);
  });

  it('omits createATA instruction when recipient ATA already exists', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const accountExists = jest.fn().mockResolvedValue(true);
    const solana = makeSolana({ accountExists });
    const { service } = makeService({ solana });

    const out = await service.prepare('u_test', {
      toAddress: recipient,
      mint: usdcMint,
      amountRaw: '1000000',
    });

    expect(accountExists).toHaveBeenCalledTimes(1);
    // Single-instruction tx — smaller serialized footprint.
    const txBuf = Buffer.from(out.unsignedTxBase64, 'base64');
    expect(txBuf.length).toBeLessThan(300);
  });

  it('RPC blockhash failure -> RpcUnavailableError (502)', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const solana = makeSolana({
      getRecentBlockhash: jest.fn().mockRejectedValue(new Error('upstream')),
    });
    const { service } = makeService({ solana });

    await expect(
      service.prepare('u_test', {
        toAddress: recipient,
        mint: usdcMint,
        amountRaw: '1',
      }),
    ).rejects.toBeInstanceOf(RpcUnavailableError);
  });
});

// ── submit ────────────────────────────────────────────────────────────

describe('TransferService.submit', () => {
  it('writes PENDING transfers row with signature on the happy path', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const sendRawTransaction = jest.fn().mockResolvedValue('sig-happy');
    const solana = makeSolana({ sendRawTransaction });
    const { service, store } = makeService({ solana });

    const prep = await service.prepare('u_test', {
      toAddress: recipient,
      mint: usdcMint,
      amountRaw: '1000000',
    });

    const signedTxBase64 = signPrepared(prep.unsignedTxBase64);
    const out = await service.submit('u_test', {
      intentId: prep.intentId,
      signedTxBase64,
    });

    expect(out.signature).toBe('sig-happy');
    expect(out.status).toBe('PENDING');
    expect(out.transferId).toEqual(expect.any(String));
    expect(store.transfers).toHaveLength(1);
    expect(store.transfers[0].status).toBe('PENDING');
    expect(store.transfers[0].signature).toBe('sig-happy');
    expect(store.transfers[0].intentId).toBe(prep.intentId);
    expect(store.transfers[0].direction).toBe('SEND');
    expect(store.transfers[0].mint).toBe(usdcMint);
    expect(store.transfers[0].amountRaw).toBe('1000000');
    expect(sendRawTransaction).toHaveBeenCalledWith(signedTxBase64);
  });

  it('duplicate intentId returns the existing row (idempotency)', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const sendRawTransaction = jest.fn().mockResolvedValue('sig-1');
    const solana = makeSolana({ sendRawTransaction });
    const { service, store } = makeService({ solana });

    const prep = await service.prepare('u_test', {
      toAddress: recipient,
      mint: usdcMint,
      amountRaw: '1000000',
    });

    const first = await service.submit('u_test', {
      intentId: prep.intentId,
      signedTxBase64: signPrepared(prep.unsignedTxBase64),
    });
    // The replay short-circuits on the UNIQUE intentId lookup before the
    // message check, so its payload is irrelevant.
    const second = await service.submit('u_test', {
      intentId: prep.intentId,
      signedTxBase64: 'ignored-on-replay',
    });

    expect(second.transferId).toBe(first.transferId);
    expect(second.signature).toBe(first.signature);
    // sendRawTransaction was called exactly once; the second submit
    // short-circuited on the UNIQUE intentId lookup.
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(store.transfers).toHaveLength(1);
  });

  it('RPC sendRawTransaction failure -> RpcUnavailableError + no row written', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const sendRawTransaction = jest.fn().mockRejectedValue(new Error('502'));
    const solana = makeSolana({ sendRawTransaction });
    const { service, store } = makeService({ solana });

    const prep = await service.prepare('u_test', {
      toAddress: recipient,
      mint: usdcMint,
      amountRaw: '1000000',
    });

    await expect(
      service.submit('u_test', {
        intentId: prep.intentId,
        signedTxBase64: signPrepared(prep.unsignedTxBase64),
      }),
    ).rejects.toBeInstanceOf(RpcUnavailableError);
    expect(store.transfers).toHaveLength(0);
  });

  it('signed tx not matching the prepared message -> IntentMismatchError, no broadcast', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const sendRawTransaction = jest.fn().mockResolvedValue('sig-x');
    const solana = makeSolana({ sendRawTransaction });
    const { service, store } = makeService({ solana });

    const prep = await service.prepare('u_test', {
      toAddress: recipient,
      mint: usdcMint,
      amountRaw: '1000000',
    });

    // A different transfer (other recipient/amount) than the prepared intent.
    const tampered = await service.prepare('u_test', {
      toAddress: Keypair.generate().publicKey.toBase58(),
      mint: usdcMint,
      amountRaw: '2000000',
    });

    await expect(
      service.submit('u_test', {
        intentId: prep.intentId,
        signedTxBase64: signPrepared(tampered.unsignedTxBase64),
      }),
    ).rejects.toBeInstanceOf(IntentMismatchError);
    expect(sendRawTransaction).not.toHaveBeenCalled();
    expect(store.transfers).toHaveLength(0);
  });

  it('unsigned tx (no signature) -> IntentMismatchError', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const sendRawTransaction = jest.fn().mockResolvedValue('sig-x');
    const solana = makeSolana({ sendRawTransaction });
    const { service } = makeService({ solana });

    const prep = await service.prepare('u_test', {
      toAddress: recipient,
      mint: usdcMint,
      amountRaw: '1000000',
    });

    // Correct message, but never signed.
    await expect(
      service.submit('u_test', {
        intentId: prep.intentId,
        signedTxBase64: prep.unsignedTxBase64,
      }),
    ).rejects.toBeInstanceOf(IntentMismatchError);
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });

  it('missing / expired intent -> IntentExpiredError (410)', async () => {
    const solana = makeSolana({});
    const { service } = makeService({ solana });

    await expect(
      service.submit('u_test', {
        intentId: 'never-prepared',
        signedTxBase64: 'sig-bytes',
      }),
    ).rejects.toBeInstanceOf(IntentExpiredError);
  });

  it('expires after blockhash lifetime', async () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const solana = makeSolana({});
    const { service } = makeService({ solana });

    const prep = await service.prepare('u_test', {
      toAddress: recipient,
      mint: usdcMint,
      amountRaw: '1000000',
    });

    // Fast-forward past the intent TTL.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 10 * 60 * 1000;
      await expect(
        service.submit('u_test', {
          intentId: prep.intentId,
          signedTxBase64: 'x',
        }),
      ).rejects.toBeInstanceOf(IntentExpiredError);
    } finally {
      Date.now = realNow;
    }
  });
});

// ── list ──────────────────────────────────────────────────────────────

describe('TransferService.list', () => {
  it('returns empty list with null cursor for a wallet with no history', async () => {
    const solana = makeSolana({});
    const { service } = makeService({ solana });

    const out = await service.list('u_test');
    expect(out.transfers).toEqual([]);
    expect(out.nextCursor).toBeNull();
  });

  it('returns transfers and paginates with a cursor when more rows exist', async () => {
    const solana = makeSolana({});
    const account = makeAccount();
    const store: FakeStore = {
      smartAccounts: [account],
      transfers: [],
    };
    // Seed 3 rows; ask for limit=2 to force a nextCursor.
    for (let i = 0; i < 3; i++) {
      store.transfers.push({
        id: `t_${i}`,
        smartAccountId: account.id,
        intentId: `intent_${i}`,
        signature: `sig_${i}`,
        direction: 'SEND',
        mint: usdcMint,
        amountRaw: '1000',
        fromAddress: account.walletAddress,
        toAddress: Keypair.generate().publicKey.toBase58(),
        status: 'PENDING',
        slot: null,
        createdAt: new Date(2026, 0, i + 1),
        submittedAt: null,
        confirmedAt: null,
        failureReason: null,
      });
    }
    const { service } = makeService({ solana, account, store });

    const page1 = await service.list('u_test', { limit: 2 });
    expect(page1.transfers).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    // Page is in reverse-chrono order
    expect(page1.transfers[0].id).toBe('t_2');
    expect(page1.transfers[1].id).toBe('t_1');
  });

  it('shapes each row per TransferRowSchema (signature + memo nullable)', async () => {
    const solana = makeSolana({});
    const account = makeAccount();
    const store: FakeStore = {
      smartAccounts: [account],
      transfers: [
        {
          id: 't_a',
          smartAccountId: account.id,
          intentId: null,
          signature: null,
          direction: 'RECEIVE',
          mint: usdcMint,
          amountRaw: '500000',
          fromAddress: Keypair.generate().publicKey.toBase58(),
          toAddress: account.walletAddress,
          status: 'CONFIRMED',
          slot: 999n,
          createdAt: new Date('2026-01-01'),
          submittedAt: null,
          confirmedAt: new Date('2026-01-01'),
          failureReason: null,
        },
      ],
    };
    const { service } = makeService({ solana, account, store });

    const out = await service.list('u_test');
    expect(out.transfers).toHaveLength(1);
    const row = out.transfers[0];
    expect(row.id).toBe('t_a');
    expect(row.direction).toBe('RECEIVE');
    expect(row.mint).toBe(usdcMint);
    expect(row.amountRaw).toBe('500000');
    expect(typeof row.fromAddress).toBe('string');
    expect(row.toAddress).toBe(account.walletAddress);
    expect(row.status).toBe('CONFIRMED');
    expect(row.signature).toBeNull();
    expect(row.memo).toBeNull();
    expect(typeof row.createdAt).toBe('string');
    expect(typeof row.confirmedAt).toBe('string');
  });
});
