import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import type {
  WalletProvider,
  WalletProviderUser,
} from '../wallet/wallet-provider.interface';
import { passkeyCredentials, smartAccounts, users } from '../db/schema';
import { IdentityService } from './identity.service';

/** NODE_ENV stub; defaults to a non-development value (production path). */
function makeConfig(nodeEnv: string = 'test'): ConfigService {
  return {
    get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined),
  } as unknown as ConfigService;
}

type UsersRow = typeof users.$inferSelect;
type SmartAccountsRow = typeof smartAccounts.$inferSelect;
type PasskeyRow = typeof passkeyCredentials.$inferSelect;

function userRow(over: Partial<UsersRow> = {}): UsersRow {
  return {
    id: 'u1',
    email: 'a@b.com',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...over,
  };
}

function accountRow(over: Partial<SmartAccountsRow> = {}): SmartAccountsRow {
  return {
    id: 'sa1',
    userId: 'u1',
    walletAddress: 'Wallet1',
    provider: 'privy',
    providerUserId: 'p1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function credRow(over: Partial<PasskeyRow> = {}): PasskeyRow {
  return {
    id: 'pk1',
    userId: 'u1',
    credentialId: 'cred_1',
    publicKey: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function makeFakeDb(store: {
  passkeyCredentials?: PasskeyRow[];
  users?: UsersRow[];
  smartAccounts?: SmartAccountsRow[];
}): DbService {
  const dispatch = (tbl: unknown): unknown[] => {
    if (tbl === passkeyCredentials) return store.passkeyCredentials ?? [];
    if (tbl === users) return store.users ?? [];
    if (tbl === smartAccounts) return store.smartAccounts ?? [];
    throw new Error('unknown table in fake select');
  };
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        const rows = dispatch(tbl);
        const chain = {
          where: () => chain,
          limit: () => Promise.resolve(rows),
        };
        return chain;
      },
    }),
  };
  return { client } as unknown as DbService;
}

const providerUser: WalletProviderUser = {
  providerUserId: 'p1',
  email: 'a@b.com',
  walletAddress: 'Wallet1',
  passkeys: [],
};

describe('IdentityService.resolveByCredentialId', () => {
  it('resolves a Consumer from the credential mirror with no vendor call', async () => {
    const verifyIdToken = jest.fn();
    const wallet = {
      verifyIdToken,
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const db = makeFakeDb({
      passkeyCredentials: [credRow()],
      users: [userRow()],
      smartAccounts: [accountRow()],
    });
    const service = new IdentityService(db, wallet, makeConfig());

    const profile = await service.resolveByCredentialId('cred_1');

    expect(profile).toEqual({
      consumerId: 'u1',
      accountAddress: 'Wallet1',
      email: 'a@b.com',
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects an unknown credential with UNKNOWN_CONSUMER', async () => {
    const wallet = {
      verifyIdToken: jest.fn(),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const db = makeFakeDb({ passkeyCredentials: [] });
    const service = new IdentityService(db, wallet, makeConfig());
    await expect(service.resolveByCredentialId('ghost')).rejects.toMatchObject({
      code: 'UNKNOWN_CONSUMER',
    });
  });
});

describe('IdentityService.resolveByProviderToken', () => {
  it('maps a verified provider user to a Consumer profile', async () => {
    const verifyIdToken = jest.fn().mockResolvedValue(providerUser);
    const wallet = {
      verifyIdToken,
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const db = makeFakeDb({
      users: [userRow()],
      smartAccounts: [accountRow()],
    });
    const service = new IdentityService(db, wallet, makeConfig());

    const profile = await service.resolveByProviderToken('token');

    expect(verifyIdToken).toHaveBeenCalledWith('token');
    expect(profile.consumerId).toBe('u1');
    expect(profile.accountAddress).toBe('Wallet1');
  });

  it('rejects a provider user with no Account with UNKNOWN_CONSUMER', async () => {
    const wallet = {
      verifyIdToken: jest.fn().mockResolvedValue(providerUser),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const db = makeFakeDb({ smartAccounts: [] });
    const service = new IdentityService(db, wallet, makeConfig());
    await expect(service.resolveByProviderToken('token')).rejects.toMatchObject(
      { code: 'UNKNOWN_CONSUMER' },
    );
  });

  it('auto-provisions a Consumer when NODE_ENV=development and no Account exists (TEST ONLY)', async () => {
    const wallet = {
      verifyIdToken: jest.fn().mockResolvedValue(providerUser),
      getUser: jest.fn(),
    } as unknown as WalletProvider;
    const { db, store } = makeStatefulDb();
    const service = new IdentityService(db, wallet, makeConfig('development'));

    const profile = await service.resolveByProviderToken('token');

    // A users row and a smart_accounts row are written (the /auth/exchange
    // insert shape), and the resolved profile points at them.
    expect(store.users).toHaveLength(1);
    expect(store.smartAccounts).toHaveLength(1);
    expect(store.users[0].email).toBe('a@b.com');
    expect(store.smartAccounts[0].providerUserId).toBe('p1');
    expect(store.smartAccounts[0].walletAddress).toBe('Wallet1');
    expect(profile).toEqual({
      consumerId: store.users[0].id,
      accountAddress: 'Wallet1',
      email: 'a@b.com',
    });
  });
});

/**
 * A minimal stateful fake DB: `select` returns whatever the per-table store
 * currently holds (the `where` clause is a no-op), and `insert` mutates the
 * store. Enough to exercise the dev auto-provision write-then-read path.
 */
function makeStatefulDb(): {
  db: DbService;
  store: { users: UsersRow[]; smartAccounts: SmartAccountsRow[] };
} {
  const store: { users: UsersRow[]; smartAccounts: SmartAccountsRow[] } = {
    users: [],
    smartAccounts: [],
  };
  let nextId = 0;
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        const rows =
          tbl === users
            ? store.users
            : tbl === smartAccounts
              ? store.smartAccounts
              : [];
        const chain = {
          where: () => chain,
          limit: () => Promise.resolve(rows),
        };
        return chain;
      },
    }),
    insert: (tbl: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (tbl === users) {
          const row = userRow({
            id: `u_new_${nextId++}`,
            email: vals.email as string,
          });
          return {
            returning: () => {
              store.users.push(row);
              return Promise.resolve([row]);
            },
          };
        }
        const acct = accountRow({
          id: `sa_new_${nextId++}`,
          userId: vals.userId as string,
          walletAddress: vals.walletAddress as string,
          providerUserId: vals.providerUserId as string,
        });
        return {
          onConflictDoUpdate: () => {
            store.smartAccounts.push(acct);
            return Promise.resolve(undefined);
          },
        };
      },
    }),
  };
  return { db: { client } as unknown as DbService, store };
}
