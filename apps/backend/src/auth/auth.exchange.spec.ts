import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import type { GridService } from '../grid/grid.service';
import type { DbService } from '../db/db.service';
import type {
  WalletProvider,
  WalletProviderUser,
} from '../wallet/wallet-provider.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import {
  InvalidPrivyTokenError,
  PrivyUnavailableError,
  PrivyUserShapeError,
} from '../wallet/privy.errors';
import { users, smartAccounts } from '../db/schema';

/**
 * Integration tests for AuthService.exchange().
 *
 * The Drizzle client is fully stubbed in-memory — we are exercising
 * the upsert branching (new user vs existing user, smart_account
 * insert vs touch) and the Privy error -> HTTP mapping in isolation
 * from Postgres. A real-DB integration test belongs in the cURL E2E
 * (PLAN.md "Verification (devnet)") which is gated on populated
 * Privy + Helius credentials.
 *
 * Test plan rows from PLAN.md covered here:
 *   - auth/exchange: new user inserts users + smart_accounts (isNewUser=true)
 *   - auth/exchange: existing user returns same row (isNewUser=false)
 *   - auth/exchange: bad Privy token returns 401
 *   - auth/exchange: Privy outage returns 502
 *   - auth/exchange: Privy user-shape error returns 422 EMAIL_MISMATCH
 *   - auth/exchange: ZodValidationPipe is covered separately at the
 *     controller layer (BadRequestException on empty body).
 */

// ── In-memory drizzle stub ────────────────────────────────────────────
//
// Drizzle's fluent chain is `db.select().from(t).where(c).limit(1)`
// returning a promise of rows; `db.insert(t).values(v).returning()`
// returns the inserted rows; `db.update(t).set(v).where(c).returning()`
// returns the updated rows. We model a minimal subset that covers
// users + smart_accounts and the predicates the exchange path uses.

type UsersRow = typeof users.$inferSelect;
type SmartAccountsRow = typeof smartAccounts.$inferSelect;

interface FakeStore {
  users: UsersRow[];
  smartAccounts: SmartAccountsRow[];
}

function makeFakeDb(store: FakeStore): DbService {
  // We rely on table identity (the imported `users` / `smartAccounts`
  // symbols) to dispatch fluent calls to the right collection.
  const collectionFor = (tbl: unknown): 'users' | 'smartAccounts' => {
    if (tbl === users) return 'users';
    if (tbl === smartAccounts) return 'smartAccounts';
    throw new Error('unknown table in fake db');
  };

  // Each fluent call returns a thenable so callers can `await` directly
  // OR chain. We capture state across the chain via closures.
  // drizzle's `eq()` returns an opaque SQL object (not a function).
  // For the upsert paths we only need "is the row present?" semantics:
  //   - users: at most one row per email; the seeded fixture is the
  //     intended target.
  //   - smart_accounts: at most one row per providerUserId.
  // We therefore treat `where(opaque)` as match-all, which works
  // because each test starts with at most one row in each collection
  // (the seeded fixture). When the collection is empty the chain
  // returns an empty array and the "new user" branch runs.
  const makeSelectChain = (collection: 'users' | 'smartAccounts') => {
    const ctx: { limit?: number } = {};
    const rowsAccessor = () => store[collection] as Record<string, unknown>[];
    const execute = () => {
      let rows = rowsAccessor();
      if (ctx.limit !== undefined) rows = rows.slice(0, ctx.limit);
      return Promise.resolve(rows);
    };
    const chain: Record<string, unknown> = {
      where: () => chain,
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
          const row =
            collection === 'users'
              ? {
                  id: `u_${store.users.length + 1}`,
                  email: vals.email,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                }
              : {
                  id: `sa_${store.smartAccounts.length + 1}`,
                  userId: vals.userId,
                  walletAddress: vals.walletAddress,
                  provider: vals.provider ?? 'privy',
                  providerUserId: vals.providerUserId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                };
          (store[collection] as Record<string, unknown>[]).push(row);
          return {
            returning: () => Promise.resolve([row]),
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve([row]).then(resolve),
          };
        },
      };
    },
    update: (tbl: unknown) => {
      const collection = collectionFor(tbl);
      const ctx: { values?: Record<string, unknown> } = {};
      const apply = () => {
        // Same simplification as select: tests work with at most one
        // row per collection, so match-all is correct.
        const rows = store[collection] as Record<string, unknown>[];
        rows.forEach((row) => Object.assign(row, ctx.values));
        return rows.slice();
      };
      const chain: Record<string, unknown> = {
        set: (vals: Record<string, unknown>) => {
          ctx.values = vals;
          return chain;
        },
        where: () => chain,
        returning: () => Promise.resolve(apply()),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(apply()).then(resolve),
      };
      return chain;
    },
  };

  return { client } as unknown as DbService;
}

// drizzle's `eq` returns an opaque SQL object. The fake select/update
// chains receive that opaque value via .where(); for our predicate-
// based fake we wrap the user-supplied predicate in a sentinel. We
// re-export a fake `eq` mock — BUT the production code imports `eq`
// from drizzle-orm directly. To avoid juggling jest.mock for a tiny
// surface, we have the fake store ignore the SQL opaque and instead
// match by reading the values we expect to be queried. The store
// holds at most one row per key in these tests, so equality is
// trivially satisfied: any predicate matches everything in the small
// collection, and we control state via deliberate inserts.

// Easier path: stub the fluent calls so `.where()` ignores its arg and
// returns all rows; tests assert on the upsert side effects, not the
// query language. We already do that above (predicate is a noop when
// `where` receives a non-callable). The check at the top of the chain
// treats `where(opaqueSql)` as "filter nothing".

function makeFakeSolana(overrides: Partial<SolanaRpc> = {}): {
  rpc: SolanaRpc;
  registerWebhookAddress: jest.Mock;
} {
  const registerWebhookAddress = jest.fn().mockResolvedValue(undefined);
  const rpc = {
    getRecentBlockhash: jest.fn(),
    getTokenBalances: jest.fn(),
    sendRawTransaction: jest.fn(),
    getSignatureStatuses: jest.fn(),
    accountExists: jest.fn(),
    streamConfirmedTransfers: jest.fn(),
    registerWebhookAddress,
    unregisterWebhookAddress: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    ...overrides,
  } as unknown as SolanaRpc;
  return { rpc, registerWebhookAddress };
}

function makeService(opts: {
  wallet: WalletProvider;
  store?: FakeStore;
  jwtSecret?: string;
  solana?: SolanaRpc;
}): { service: AuthService; store: FakeStore; solana: SolanaRpc } {
  const store: FakeStore = opts.store ?? { users: [], smartAccounts: [] };
  const db = makeFakeDb(store);
  const jwt = new JwtService({
    secret: opts.jwtSecret ?? 'test-secret',
  });
  // GridService is not exercised by exchange(); pass an empty object.
  const grid = {} as GridService;
  const solana = opts.solana ?? makeFakeSolana().rpc;
  const service = new AuthService(grid, jwt, db, opts.wallet, solana);
  return { service, store, solana };
}

const validPrivyUser: WalletProviderUser = {
  providerUserId: 'did:privy:abc123',
  email: 'user@example.com',
  walletAddress: 'SoLAnAaDdRess111111111111111111111111111111',
};

describe('AuthService.exchange', () => {
  it('new user inserts users + smart_accounts (isNewUser=true)', async () => {
    const verifyIdToken = jest.fn().mockResolvedValue(validPrivyUser);
    const wallet = {
      verifyIdToken,
      getUser: jest.fn(),
    } as unknown as WalletProvider;

    const { service, store } = makeService({ wallet });

    const result = await service.exchange('valid.privy.token');

    expect(verifyIdToken).toHaveBeenCalledWith('valid.privy.token');
    expect(result.user.isNewUser).toBe(true);
    expect(result.user.email).toBe(validPrivyUser.email);
    expect(result.user.walletAddress).toBe(validPrivyUser.walletAddress);
    expect(result.token).toEqual(expect.any(String));
    expect(result.token.length).toBeGreaterThan(0);
    expect(store.users).toHaveLength(1);
    expect(store.users[0].email).toBe(validPrivyUser.email);
    expect(store.smartAccounts).toHaveLength(1);
    expect(store.smartAccounts[0].walletAddress).toBe(
      validPrivyUser.walletAddress,
    );
    expect(store.smartAccounts[0].providerUserId).toBe(
      validPrivyUser.providerUserId,
    );
    expect(store.smartAccounts[0].provider).toBe('privy');
  });

  it('existing user returns same row (isNewUser=false)', async () => {
    const wallet = {
      verifyIdToken: jest.fn().mockResolvedValue(validPrivyUser),
      getUser: jest.fn(),
    } as unknown as WalletProvider;

    // Seed the store with an existing user + smart_account.
    const seedStore: FakeStore = {
      users: [
        {
          id: 'u_existing',
          email: validPrivyUser.email,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
      smartAccounts: [
        {
          id: 'sa_existing',
          userId: 'u_existing',
          walletAddress: validPrivyUser.walletAddress,
          provider: 'privy',
          providerUserId: validPrivyUser.providerUserId,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
    };

    const { service, store } = makeService({ wallet, store: seedStore });

    const result = await service.exchange('valid.privy.token');

    expect(result.user.isNewUser).toBe(false);
    expect(result.user.id).toBe('u_existing');
    expect(result.user.email).toBe(validPrivyUser.email);
    expect(result.user.walletAddress).toBe(validPrivyUser.walletAddress);
    expect(result.token).toEqual(expect.any(String));
    // No duplicate inserts — counts unchanged.
    expect(store.users).toHaveLength(1);
    expect(store.smartAccounts).toHaveLength(1);
    // updated_at was touched on both rows.
    expect(store.users[0].updatedAt.getTime()).toBeGreaterThan(
      new Date('2026-01-01').getTime(),
    );
    expect(store.smartAccounts[0].updatedAt.getTime()).toBeGreaterThan(
      new Date('2026-01-01').getTime(),
    );
  });

  it('bad Privy token returns 401 INVALID_PRIVY_TOKEN', async () => {
    const wallet = {
      verifyIdToken: jest
        .fn()
        .mockRejectedValue(
          new InvalidPrivyTokenError('Token signature invalid'),
        ),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const { service } = makeService({ wallet });

    await expect(service.exchange('bad.token')).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { code: 'INVALID_PRIVY_TOKEN' },
    });
  });

  it('Privy outage returns 502 PRIVY_UNAVAILABLE', async () => {
    const wallet = {
      verifyIdToken: jest
        .fn()
        .mockRejectedValue(new PrivyUnavailableError('Helius 503')),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const { service } = makeService({ wallet });

    await expect(service.exchange('any.token')).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      response: { code: 'PRIVY_UNAVAILABLE' },
    });
  });

  it('Privy user shape error returns 422 EMAIL_MISMATCH', async () => {
    const wallet = {
      verifyIdToken: jest
        .fn()
        .mockRejectedValue(new PrivyUserShapeError('No Solana wallet linked')),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const { service } = makeService({ wallet });

    await expect(service.exchange('partial.token')).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      response: { code: 'EMAIL_MISMATCH' },
    });
  });

  it('new user triggers webhook registration with wallet address', async () => {
    const verifyIdToken = jest.fn().mockResolvedValue(validPrivyUser);
    const wallet = {
      verifyIdToken,
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const { rpc, registerWebhookAddress } = makeFakeSolana();
    const { service } = makeService({ wallet, solana: rpc });

    await service.exchange('valid.privy.token');
    expect(registerWebhookAddress).toHaveBeenCalledWith(
      validPrivyUser.walletAddress,
    );
  });

  it('webhook registration failure does NOT break /auth/exchange', async () => {
    const verifyIdToken = jest.fn().mockResolvedValue(validPrivyUser);
    const wallet = {
      verifyIdToken,
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const { rpc } = makeFakeSolana({
      registerWebhookAddress: jest
        .fn()
        .mockRejectedValue(new Error('helius webhook api down')),
    });
    const { service, store } = makeService({ wallet, solana: rpc });

    const result = await service.exchange('valid.privy.token');
    expect(result.user.walletAddress).toBe(validPrivyUser.walletAddress);
    expect(result.token).toEqual(expect.any(String));
    // smart_account was still written; webhook failure is non-fatal.
    expect(store.smartAccounts).toHaveLength(1);
  });

  it('existing user does NOT re-register webhook (idempotency)', async () => {
    const wallet = {
      verifyIdToken: jest.fn().mockResolvedValue(validPrivyUser),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const seedStore: FakeStore = {
      users: [
        {
          id: 'u_existing',
          email: validPrivyUser.email,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
      smartAccounts: [
        {
          id: 'sa_existing',
          userId: 'u_existing',
          walletAddress: validPrivyUser.walletAddress,
          provider: 'privy',
          providerUserId: validPrivyUser.providerUserId,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
    };
    const { rpc, registerWebhookAddress } = makeFakeSolana();
    const { service } = makeService({
      wallet,
      store: seedStore,
      solana: rpc,
    });

    await service.exchange('valid.privy.token');
    // The smart_account already existed — no INSERT, no registration.
    expect(registerWebhookAddress).not.toHaveBeenCalled();
  });

  it('unknown adapter error maps to 502 PRIVY_UNAVAILABLE (defensive)', async () => {
    const wallet = {
      verifyIdToken: jest.fn().mockRejectedValue(new Error('random')),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const { service } = makeService({ wallet });

    await expect(service.exchange('any.token')).rejects.toBeInstanceOf(
      HttpException,
    );
    await expect(service.exchange('any.token')).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      response: { code: 'PRIVY_UNAVAILABLE' },
    });
  });
});
