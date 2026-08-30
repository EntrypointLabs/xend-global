import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService, CredentialConflictError } from './auth.service';
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
import { users, smartAccounts, passkeyCredentials } from '../db/schema';
import type { SignupService } from './signup.service';
import { SignupTokenInvalidError } from './signup.errors';

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
type PasskeyCredentialsRow = typeof passkeyCredentials.$inferSelect;

type Collection = 'users' | 'smartAccounts' | 'passkeyCredentials';

interface FakeStore {
  users: UsersRow[];
  smartAccounts: SmartAccountsRow[];
  passkeyCredentials?: PasskeyCredentialsRow[];
}

function makeFakeDb(store: FakeStore): DbService {
  // Seed stores may omit passkeyCredentials; normalize so the collection
  // always exists.
  if (!store.passkeyCredentials) store.passkeyCredentials = [];

  // We rely on table identity (the imported `users` / `smartAccounts` /
  // `passkeyCredentials` symbols) to dispatch fluent calls to the right
  // collection.
  const collectionFor = (tbl: unknown): Collection => {
    if (tbl === users) return 'users';
    if (tbl === smartAccounts) return 'smartAccounts';
    if (tbl === passkeyCredentials) return 'passkeyCredentials';
    throw new Error('unknown table in fake db');
  };

  // `where(opaqueSql)` is treated as match-all: each test starts with at
  // most one row per collection (the seeded fixture), so when the
  // collection is empty the chain returns [] and the "new user" branch
  // runs.
  const makeSelectChain = (collection: Collection) => {
    const ctx: { limit?: number; joinedUsers?: boolean } = {};
    const rowsAccessor = () => store[collection] as Record<string, unknown>[];
    const execute = () => {
      let rows = rowsAccessor();
      // The one join the service makes: smart_accounts -> users, selected as
      // `{ user }`. Resolved by userId rather than match-all, because the
      // point of the query is that the Privy DID picks out one Consumer.
      if (ctx.joinedUsers) {
        rows = rows
          .map((row) => ({
            user: (store.users as Record<string, unknown>[]).find(
              (u) => u.id === row.userId,
            ),
          }))
          .filter((row) => row.user !== undefined) as Record<string, unknown>[];
      }
      if (ctx.limit !== undefined) rows = rows.slice(0, ctx.limit);
      return Promise.resolve(rows);
    };
    const chain: Record<string, unknown> = {
      where: () => chain,
      innerJoin: () => {
        ctx.joinedUsers = true;
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
      const build = (v: Record<string, unknown>): Record<string, unknown> => {
        if (collection === 'users') {
          return {
            id: `u_${store.users.length + 1}`,
            email: v.email,
            notificationsEnabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        if (collection === 'smartAccounts') {
          return {
            id: `sa_${store.smartAccounts.length + 1}`,
            userId: v.userId,
            walletAddress: v.walletAddress,
            provider: v.provider ?? 'privy',
            providerUserId: v.providerUserId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return {
          id: `pk_${store.passkeyCredentials!.length + 1}`,
          userId: v.userId,
          credentialId: v.credentialId,
          publicKey: v.publicKey ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      };
      return {
        // `.values()` accepts one record or an array (bulk insert, used by
        // the passkey mirror).
        values: (vals: Record<string, unknown> | Record<string, unknown>[]) => {
          const inputs = Array.isArray(vals) ? vals : [vals];
          const rows = store[collection] as Record<string, unknown>[];
          const insertAll = () =>
            inputs.map((v) => {
              // The one constraint the exchange path leans on: users.email is
              // unique, and a fresh row may not take an address a row it
              // cannot reach already holds.
              if (
                collection === 'users' &&
                v.email &&
                rows.some((r) => r.email === v.email)
              ) {
                throw Object.assign(new Error('duplicate key value'), {
                  code: '23505',
                });
              }
              const row = build(v);
              rows.push(row);
              return row;
            });
          return {
            // Models INSERT ... ON CONFLICT (user_id) DO UPDATE for
            // smart_accounts: if a row with the same userId exists, patch
            // it with `set`; otherwise insert. Match-all is fine because
            // tests keep at most one smart_account row.
            onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
              const v = inputs[0];
              const conflict =
                collection === 'smartAccounts'
                  ? rows.find((r) => r.userId === v.userId)
                  : undefined;
              let row: Record<string, unknown>;
              if (conflict) {
                Object.assign(conflict, cfg.set);
                row = conflict;
              } else {
                row = build(v);
                rows.push(row);
              }
              return {
                returning: () => Promise.resolve([row]),
                then: (resolve: (val: unknown) => unknown) =>
                  Promise.resolve([row]).then(resolve),
              };
            },
            // Models INSERT ... ON CONFLICT (credential_id) DO NOTHING for
            // the passkey mirror: replays collapse by credentialId.
            onConflictDoNothing: () => {
              const inserted: Record<string, unknown>[] = [];
              for (const v of inputs) {
                const exists =
                  collection === 'passkeyCredentials'
                    ? rows.some((r) => r.credentialId === v.credentialId)
                    : false;
                if (!exists) {
                  const row = build(v);
                  rows.push(row);
                  inserted.push(row);
                }
              }
              return {
                returning: () => Promise.resolve(inserted),
                then: (resolve: (val: unknown) => unknown) =>
                  Promise.resolve(inserted).then(resolve),
              };
            },
            returning: () =>
              new Promise((resolve, reject) => {
                try {
                  resolve(insertAll());
                } catch (err) {
                  reject(err as Error);
                }
              }),
            then: (
              resolve: (val: unknown) => unknown,
              reject?: (err: unknown) => unknown,
            ) =>
              new Promise((res, rej) => {
                try {
                  res(insertAll());
                } catch (err) {
                  rej(err as Error);
                }
              }).then(resolve, reject),
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
    getSolBalance: jest.fn().mockResolvedValue(0n),
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

/**
 * The sign-up token is spent by SignupService, which has its own spec. Here it
 * is a map from token to the users row it binds, so the exchange's half of
 * the contract can be exercised: which row it lands on, and what it refuses.
 */
function makeFakeSignup(store: FakeStore, tokens: Record<string, string>) {
  const claimed: string[] = [];
  const signup = {
    claimSignupToken: (raw: string) => {
      claimed.push(raw);
      const userId = tokens[raw];
      const user = userId && store.users.find((u) => u.id === userId);
      if (!user) {
        return Promise.reject(
          new SignupTokenInvalidError('that sign-up token is not valid'),
        );
      }
      return Promise.resolve(user);
    },
  } as unknown as SignupService;
  return { signup, claimed };
}

function makeService(opts: {
  wallet: WalletProvider;
  store?: FakeStore;
  jwtSecret?: string;
  solana?: SolanaRpc;
  tokens?: Record<string, string>;
}): {
  service: AuthService;
  store: FakeStore;
  solana: SolanaRpc;
  claimed: string[];
} {
  const store: FakeStore = opts.store ?? { users: [], smartAccounts: [] };
  const db = makeFakeDb(store);
  const jwt = new JwtService({
    secret: opts.jwtSecret ?? 'test-secret',
  });
  const solana = opts.solana ?? makeFakeSolana().rpc;
  const { signup, claimed } = makeFakeSignup(store, opts.tokens ?? {});
  const service = new AuthService(
    jwt,
    db,
    opts.wallet,
    solana,
    signup,
  );
  return { service, store, solana, claimed };
}

/** A row the email step left behind: proved address, nothing bound to it. */
function pendingUser(id: string, email: string): UsersRow {
  return {
    id,
    email,
    notificationsEnabled: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    recoveryReleaseFrozenAt: null,
  };
}

const validPrivyUser: WalletProviderUser = {
  providerUserId: 'did:privy:abc123',
  email: 'user@example.com',
  walletAddress: 'SoLAnAaDdRess111111111111111111111111111111',
  passkeys: [],
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
          notificationsEnabled: true,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          deletedAt: null,
          recoveryReleaseFrozenAt: null,
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

  it('answers a passkey-only sign-up with no email at all', async () => {
    const wallet = {
      verifyIdToken: jest.fn().mockResolvedValue({
        ...validPrivyUser,
        email: null,
      }),
      getUser: jest.fn(),
    } as unknown as WalletProvider;

    const { service, store } = makeService({ wallet });

    const result = await service.exchange('valid.privy.token');

    // The passkey is the credential, so there is nothing to put here until
    // the Consumer offers a contact address.
    expect(result.user.email).toBeNull();
    expect(result.user.isNewUser).toBe(true);
    expect(store.users[0].email).toBeNull();
  });

  it("gives back the contact address the Consumer saved, not Privy's", async () => {
    const wallet = {
      verifyIdToken: jest.fn().mockResolvedValue({
        ...validPrivyUser,
        email: null,
      }),
      getUser: jest.fn(),
    } as unknown as WalletProvider;

    const seedStore: FakeStore = {
      users: [
        {
          id: 'u_existing',
          email: 'contact@example.com',
          notificationsEnabled: true,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          deletedAt: null,
          recoveryReleaseFrozenAt: null,
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

    const { service } = makeService({ wallet, store: seedStore });

    const result = await service.exchange('valid.privy.token');

    // Privy has no email for a passkey Consumer, so echoing it would have the
    // app forget a contact address it already holds every time they sign in.
    expect(result.user.email).toBe('contact@example.com');
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
          notificationsEnabled: true,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          deletedAt: null,
          recoveryReleaseFrozenAt: null,
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

  it('never adopts a users row by email when the Privy DID is unknown', async () => {
    // The row is somebody else's sign-up, one code away from a passkey. A
    // Privy user that Privy says holds the same address must not land on it:
    // the address is only on the row because the code was proved there.
    const wallet = {
      verifyIdToken: jest.fn().mockResolvedValue(validPrivyUser),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const seedStore: FakeStore = {
      users: [pendingUser('u_pending', validPrivyUser.email as string)],
      smartAccounts: [],
    };
    const { service, store } = makeService({ wallet, store: seedStore });

    await expect(service.exchange('valid.privy.token')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'EMAIL_IN_USE' },
    });
    expect(store.smartAccounts).toHaveLength(0);
    expect(store.users).toHaveLength(1);
  });

  describe('with a sign-up token', () => {
    const passkeyOnly: WalletProviderUser = {
      ...validPrivyUser,
      email: null,
    };

    it('binds the Privy user to the row the token was issued for', async () => {
      const wallet = {
        verifyIdToken: jest.fn().mockResolvedValue(passkeyOnly),
        getUser: jest.fn(),
      } as unknown as WalletProvider;
      const seedStore: FakeStore = {
        users: [pendingUser('u_pending', 'proved@example.com')],
        smartAccounts: [],
      };
      const { service, store, claimed } = makeService({
        wallet,
        store: seedStore,
        tokens: { xsign_good: 'u_pending' },
      });

      const result = await service.exchange('valid.privy.token', 'xsign_good');

      expect(claimed).toEqual(['xsign_good']);
      expect(result.user.id).toBe('u_pending');
      expect(result.user.isNewUser).toBe(true);
      // The proved address, which Privy knows nothing about.
      expect(result.user.email).toBe('proved@example.com');
      expect(store.users).toHaveLength(1);
      expect(store.smartAccounts).toHaveLength(1);
      expect(store.smartAccounts[0]).toMatchObject({
        userId: 'u_pending',
        providerUserId: passkeyOnly.providerUserId,
        walletAddress: passkeyOnly.walletAddress,
      });
    });

    it('answers a token that cannot be spent with 401 and binds nothing', async () => {
      // Wrong, expired, already spent, or issued for a row that has since
      // been bound: SignupService refuses them all the same way, and the
      // exchange must not fall through to the token-less path and mint a
      // fresh row for the passkey.
      const wallet = {
        verifyIdToken: jest.fn().mockResolvedValue(passkeyOnly),
        getUser: jest.fn(),
      } as unknown as WalletProvider;
      const seedStore: FakeStore = {
        users: [pendingUser('u_pending', 'proved@example.com')],
        smartAccounts: [],
      };
      const { service, store } = makeService({
        wallet,
        store: seedStore,
        tokens: { xsign_good: 'u_pending' },
      });

      await expect(
        service.exchange('valid.privy.token', 'xsign_wrong'),
      ).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
        response: { code: 'SIGNUP_TOKEN_INVALID' },
      });
      expect(store.users).toHaveLength(1);
      expect(store.smartAccounts).toHaveLength(0);
    });

    it('refuses to bind a Privy user that already belongs to another row', async () => {
      const wallet = {
        verifyIdToken: jest.fn().mockResolvedValue(passkeyOnly),
        getUser: jest.fn(),
      } as unknown as WalletProvider;
      const seedStore: FakeStore = {
        users: [
          pendingUser('u_bound', 'bound@example.com'),
          pendingUser('u_pending', 'proved@example.com'),
        ],
        smartAccounts: [
          {
            id: 'sa_bound',
            userId: 'u_bound',
            walletAddress: passkeyOnly.walletAddress,
            provider: 'privy',
            providerUserId: passkeyOnly.providerUserId,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ],
      };
      const { service, store } = makeService({
        wallet,
        store: seedStore,
        tokens: { xsign_good: 'u_pending' },
      });

      await expect(
        service.exchange('valid.privy.token', 'xsign_good'),
      ).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
        response: { code: 'SIGNUP_TOKEN_INVALID' },
      });
      // The existing binding is untouched and the pending row stays pending.
      expect(store.smartAccounts).toHaveLength(1);
      expect(store.smartAccounts[0].userId).toBe('u_bound');
    });

    it('registers the webhook for the wallet it just bound', async () => {
      const wallet = {
        verifyIdToken: jest.fn().mockResolvedValue(passkeyOnly),
        getUser: jest.fn(),
      } as unknown as WalletProvider;
      const { rpc, registerWebhookAddress } = makeFakeSolana();
      const { service } = makeService({
        wallet,
        store: {
          users: [pendingUser('u_pending', 'proved@example.com')],
          smartAccounts: [],
        },
        solana: rpc,
        tokens: { xsign_good: 'u_pending' },
      });

      await service.exchange('valid.privy.token', 'xsign_good');

      expect(registerWebhookAddress).toHaveBeenCalledWith(
        passkeyOnly.walletAddress,
      );
    });
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

  it('mirrors a passkey credential on exchange (new user)', async () => {
    const privyUserWithPasskey: WalletProviderUser = {
      ...validPrivyUser,
      passkeys: [{ credentialId: 'cred_login_1' }],
    };
    const wallet = {
      verifyIdToken: jest.fn().mockResolvedValue(privyUserWithPasskey),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const { service, store } = makeService({ wallet });

    await service.exchange('valid.privy.token');

    expect(store.passkeyCredentials).toHaveLength(1);
    expect(store.passkeyCredentials![0].credentialId).toBe('cred_login_1');
    expect(store.passkeyCredentials![0].userId).toBe(store.users[0].id);
  });

  it('replayed exchange does not duplicate the mirror row', async () => {
    const privyUserWithPasskey: WalletProviderUser = {
      ...validPrivyUser,
      passkeys: [{ credentialId: 'cred_login_1' }],
    };
    const wallet = {
      verifyIdToken: jest.fn().mockResolvedValue(privyUserWithPasskey),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const seedStore: FakeStore = {
      users: [
        {
          id: 'u_existing',
          email: validPrivyUser.email,
          notificationsEnabled: true,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          deletedAt: null,
          recoveryReleaseFrozenAt: null,
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
      passkeyCredentials: [
        {
          id: 'pk_existing',
          userId: 'u_existing',
          credentialId: 'cred_login_1',
          publicKey: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
    };
    const { service, store } = makeService({ wallet, store: seedStore });

    await service.exchange('valid.privy.token');

    expect(store.passkeyCredentials).toHaveLength(1);
  });
});

describe('AuthService.mirrorPasskeyCredential', () => {
  const dummyWallet = {
    verifyIdToken: jest.fn(),
    getUser: jest.fn(),
  } as unknown as WalletProvider;

  it('inserts a new credential with its public key', async () => {
    const { service, store } = makeService({ wallet: dummyWallet });

    const result = await service.mirrorPasskeyCredential('u_1', {
      credentialId: 'cred_1',
      publicKey: 'pubkey_1',
    });

    expect(result).toEqual({ mirrored: true });
    expect(store.passkeyCredentials).toHaveLength(1);
    expect(store.passkeyCredentials![0]).toMatchObject({
      userId: 'u_1',
      credentialId: 'cred_1',
      publicKey: 'pubkey_1',
    });
  });

  it('backfills the public key when the stored row has none', async () => {
    const seedStore: FakeStore = {
      users: [],
      smartAccounts: [],
      passkeyCredentials: [
        {
          id: 'pk_1',
          userId: 'u_1',
          credentialId: 'cred_1',
          publicKey: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
    };
    const { service, store } = makeService({
      wallet: dummyWallet,
      store: seedStore,
    });

    const result = await service.mirrorPasskeyCredential('u_1', {
      credentialId: 'cred_1',
      publicKey: 'pubkey_1',
    });

    expect(result).toEqual({ mirrored: true });
    expect(store.passkeyCredentials).toHaveLength(1);
    expect(store.passkeyCredentials![0].publicKey).toBe('pubkey_1');
  });

  it('does not overwrite an existing public key', async () => {
    const seedStore: FakeStore = {
      users: [],
      smartAccounts: [],
      passkeyCredentials: [
        {
          id: 'pk_1',
          userId: 'u_1',
          credentialId: 'cred_1',
          publicKey: 'original_pubkey',
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
    };
    const { service, store } = makeService({
      wallet: dummyWallet,
      store: seedStore,
    });

    await service.mirrorPasskeyCredential('u_1', {
      credentialId: 'cred_1',
      publicKey: 'new_pubkey',
    });

    expect(store.passkeyCredentials![0].publicKey).toBe('original_pubkey');
  });

  it('rejects a cross-account credential claim with CredentialConflictError', async () => {
    const seedStore: FakeStore = {
      users: [],
      smartAccounts: [],
      passkeyCredentials: [
        {
          id: 'pk_1',
          userId: 'u_owner',
          credentialId: 'cred_1',
          publicKey: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
    };
    const { service } = makeService({ wallet: dummyWallet, store: seedStore });

    await expect(
      service.mirrorPasskeyCredential('u_intruder', {
        credentialId: 'cred_1',
      }),
    ).rejects.toBeInstanceOf(CredentialConflictError);
  });
});
