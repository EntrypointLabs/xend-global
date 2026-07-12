import type { DbService } from '../db/db.service';
import type {
  WalletProvider,
  WalletProviderUser,
} from '../wallet/wallet-provider.interface';
import { passkeyCredentials, smartAccounts, users } from '../db/schema';
import { IdentityService } from './identity.service';

type UsersRow = typeof users.$inferSelect;
type SmartAccountsRow = typeof smartAccounts.$inferSelect;
type PasskeyRow = typeof passkeyCredentials.$inferSelect;

function userRow(over: Partial<UsersRow> = {}): UsersRow {
  return {
    id: 'u1',
    email: 'a@b.com',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
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
    const service = new IdentityService(db, wallet);

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
    const service = new IdentityService(db, wallet);
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
    const service = new IdentityService(db, wallet);

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
    const service = new IdentityService(db, wallet);
    await expect(service.resolveByProviderToken('token')).rejects.toMatchObject(
      { code: 'UNKNOWN_CONSUMER' },
    );
  });
});
