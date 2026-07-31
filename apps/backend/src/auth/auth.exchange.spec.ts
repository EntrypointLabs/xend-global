import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
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
 * The Drizzle client is fully stubbed in-memory, exercising the upsert
 * branching (new user vs existing user, smart_account insert vs touch)
 * and the Privy error -> HTTP mapping in isolation from Postgres:
 *   - new user inserts users + smart_accounts (isNewUser=true)
 *   - existing user returns same row (isNewUser=false)
 *   - bad Privy token returns 401
 *   - Privy outage returns 502
 *   - Privy user-shape error returns 422 EMAIL_MISMATCH
 *
 * ZodValidationPipe is covered separately at the controller layer.
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

  // `where(opaqueSql)` is treated as match-all: each test starts with at
  // most one row per collection (the seeded fixture), so when the
  // collection is empty the chain returns [] and the "new user" branch
  // runs.
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
          const build = () =>
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
          const insertRow = () => {
            const row = build();
            (store[collection] as Record<string, unknown>[]).push(row);
            return row;
          };
          return {
            // Models INSERT ... ON CONFLICT (user_id) DO UPDATE for
            // smart_accounts: if a row with the same userId exists, patch
            // it with `set`; otherwise insert. Match-all is fine because
            // tests keep at most one smart_account row.
            onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
              const rows = store[collection] as Record<string, unknown>[];
              const conflict =
                collection === 'smartAccounts'
                  ? rows.find((r) => r.userId === vals.userId)
                  : undefined;
              const row = conflict ?? insertRow();
              if (conflict) Object.assign(conflict, cfg.set);
              return {
                returning: () => Promise.resolve([row]),
                then: (resolve: (v: unknown) => unknown) =>
                  Promise.resolve([row]).then(resolve),
              };
            },
            returning: () => Promise.resolve([insertRow()]),
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve([insertRow()]).then(resolve),
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
  const solana = opts.solana ?? makeFakeSolana().rpc;
  const service = new AuthService(jwt, db, opts.wallet, solana);
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
          deletedAt: null,
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
          deletedAt: null,
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

  it('existing user with a NEW Privy DID + wallet upserts in place (no lockout)', async () => {
    const reAuthUser: WalletProviderUser = {
      providerUserId: 'did:privy:NEWdid999',
      email: validPrivyUser.email,
      walletAddress: 'SoLAnAaNeWwAlLeT2222222222222222222222222222',
    };
    const wallet = {
      verifyIdToken: jest.fn().mockResolvedValue(reAuthUser),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const seedStore: FakeStore = {
      users: [
        {
          id: 'u_existing',
          email: validPrivyUser.email,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          deletedAt: null,
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
    const { service, store } = makeService({
      wallet,
      store: seedStore,
      solana: rpc,
    });

    const result = await service.exchange('valid.privy.token');

    expect(result.user.id).toBe('u_existing');
    expect(result.user.isNewUser).toBe(false);
    // No duplicate smart_account row — the existing one was adopted.
    expect(store.smartAccounts).toHaveLength(1);
    expect(store.smartAccounts[0].providerUserId).toBe(
      reAuthUser.providerUserId,
    );
    expect(store.smartAccounts[0].walletAddress).toBe(reAuthUser.walletAddress);
    // The new wallet address gets its webhook registered.
    expect(registerWebhookAddress).toHaveBeenCalledWith(
      reAuthUser.walletAddress,
    );
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
