import { NotFoundException } from '@nestjs/common';
import { AccountHasBalanceError, WalletsService } from './wallets.service';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import type { TokenPriceProvider } from '../prices/token-price.interface';
import type { TokenMetadataProvider } from '../tokens/token-metadata.interface';
import type { SolanaRpc, TokenBalance } from '../solana/solana-rpc.interface';
import { smartAccounts, supportRequests, users } from '../db/schema';

/**
 * Integration tests for WalletsService.deleteMe (mounted at DELETE
 * /wallet/me). The fake DB models `select().from(smartAccounts)` as
 * match-all (same posture as wallets.me.spec.ts) and applies every write to
 * the seeded store so assertions can inspect what actually got written. It
 * holds one Consumer, so match-all is that Consumer; whose rows a delete
 * reaches is pinned against real SQL in consumer-messages.pg.spec.ts.
 */

type SmartAccountsRow = typeof smartAccounts.$inferSelect;
type UsersRow = typeof users.$inferSelect;
type SupportRequestsRow = typeof supportRequests.$inferSelect;

interface FakeStore {
  smartAccounts: SmartAccountsRow[];
  users: UsersRow[];
  supportRequests: SupportRequestsRow[];
  /** Writes made with no transaction open around them. */
  writesOutsideTransaction: number;
  /** Set to fail the write that takes the reply address off support requests. */
  failSupportUpdate?: Error;
}

function makeFakeDb(store: FakeStore): DbService {
  let open = false;
  const wrote = () => {
    if (!open) store.writesOutsideTransaction += 1;
  };
  const client = {
    select: () => ({
      from: (tbl: unknown) => ({
        where: () => ({
          limit: (n: number) =>
            Promise.resolve(
              (tbl === smartAccounts ? store.smartAccounts : []).slice(0, n),
            ),
        }),
      }),
    }),
    update: (tbl: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          wrote();
          if (tbl === users) {
            store.users = store.users.map((u) => ({ ...u, ...values }));
          }
          if (tbl === smartAccounts) {
            store.smartAccounts = store.smartAccounts.map((a) => ({
              ...a,
              ...values,
            }));
          }
          if (tbl === supportRequests) {
            if (store.failSupportUpdate) {
              return Promise.reject(store.failSupportUpdate);
            }
            store.supportRequests = store.supportRequests.map((r) => ({
              ...r,
              ...values,
            }));
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  // Rolls the store back when the work throws, as the database would.
  const withTransaction = async <T>(fn: () => Promise<T>): Promise<T> => {
    const staged = structuredClone(store);
    open = true;
    try {
      return await fn();
    } catch (err) {
      Object.assign(store, staged);
      throw err;
    } finally {
      open = false;
    }
  };
  return { client, withTransaction } as unknown as DbService;
}

function makeService(opts: {
  tokens: TokenBalance[];
  account?: SmartAccountsRow | null;
  /** Native SOL at the address, which is not a token account. */
  lamports?: bigint;
}): { service: WalletsService; store: FakeStore } {
  const store: FakeStore = {
    smartAccounts:
      opts.account === null
        ? []
        : [
            opts.account ?? {
              id: 'sa_1',
              userId: 'u_1',
              walletAddress: 'SoLAnAaDdRess111111111111111111111111111111',
              provider: 'privy',
              providerUserId: 'did:privy:abc',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
    users: [
      {
        id: 'u_1',
        email: 'consumer@example.com',
        notificationsEnabled: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        deletedAt: null,
        recoveryReleaseFrozenAt: null,
      },
    ],
    supportRequests: [
      {
        id: 'sr_1',
        userId: 'u_1',
        topic: 'payments',
        message: 'A payment did not arrive.',
        contactEmail: 'consumer@example.com',
        appVersion: null,
        platform: null,
        status: 'closed',
        createdAt: new Date('2026-02-03'),
        closedAt: new Date('2026-02-04'),
      },
    ],
    writesOutsideTransaction: 0,
  };
  const db = makeFakeDb(store);
  const solana = {
    getSolBalance: jest.fn().mockResolvedValue(opts.lamports ?? 0n),
    getTokenBalances: jest
      .fn<Promise<TokenBalance[]>, [string]>()
      .mockResolvedValue(opts.tokens),
    getRecentBlockhash: jest.fn(),
  } as unknown as SolanaRpc;
  const service = new WalletsService(
    db,
    solana,
    {
      getUsdPrices: jest.fn().mockResolvedValue(new Map()),
    } as unknown as TokenPriceProvider,
    {
      getMetadata: jest.fn().mockResolvedValue(new Map()),
    } as unknown as TokenMetadataProvider,
    {
      getOrThrow: () => 'UsDcMint',
      get: () => undefined,
    } as unknown as ConfigService,
  );
  return { service, store };
}

const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('WalletsService.deleteMe', () => {
  it('rejects with AccountHasBalanceError while a token balance remains', async () => {
    const { service } = makeService({
      tokens: [{ mint: usdcMint, amountRaw: 1_000_000n, decimals: 6 }],
    });

    await expect(service.deleteMe('u_1')).rejects.toBeInstanceOf(
      AccountHasBalanceError,
    );
  });

  it('soft-deletes the user and anonymizes the smart_accounts uniques at zero balance', async () => {
    const { service, store } = makeService({ tokens: [] });

    const result = await service.deleteMe('u_1');

    expect(result).toEqual({ deleted: true });
    expect(store.users[0].deletedAt).not.toBeNull();
    expect(store.users[0].email).toBe('deleted-u_1@deleted.prydd.internal');
    // Frees the unique wallet_address/provider_user_id so /auth/exchange can
    // re-insert a smart_accounts row if the same Privy identity signs in
    // again later, instead of hitting a stale unique-constraint conflict.
    expect(store.smartAccounts[0].walletAddress).toBe('deleted-sa_1');
    expect(store.smartAccounts[0].providerUserId).toBe('deleted-sa_1');
  });

  it('keeps what they wrote to support, with the reply address taken off it', async () => {
    const { service, store } = makeService({ tokens: [] });

    await service.deleteMe('u_1');

    expect(store.supportRequests).toEqual([
      expect.objectContaining({
        id: 'sr_1',
        userId: 'u_1',
        message: 'A payment did not arrive.',
        status: 'closed',
        contactEmail: null,
      }),
    ]);
  });

  it('leaves the reply address while a balance remains', async () => {
    const { service, store } = makeService({
      tokens: [{ mint: usdcMint, amountRaw: 1n, decimals: 6 }],
    });

    await expect(service.deleteMe('u_1')).rejects.toBeInstanceOf(
      AccountHasBalanceError,
    );

    expect(store.supportRequests[0].contactEmail).toBe('consumer@example.com');
  });

  it('writes all of it in one transaction, so a failure leaves the account as it was', async () => {
    // Closing the account locks the Consumer out. Done first and on its own,
    // a later write failing would leave them unable to sign in to finish.
    const { service, store } = makeService({ tokens: [] });
    store.failSupportUpdate = new Error('connection reset');

    await expect(service.deleteMe('u_1')).rejects.toThrow('connection reset');

    expect(store.writesOutsideTransaction).toBe(0);
    expect(store.users[0].deletedAt).toBeNull();
    expect(store.users[0].email).toBe('consumer@example.com');
    expect(store.supportRequests[0].contactEmail).toBe('consumer@example.com');
  });

  it('treats an all-zero multi-mint balance list as deletable', async () => {
    const { service } = makeService({
      tokens: [
        { mint: usdcMint, amountRaw: 0n, decimals: 6 },
        {
          mint: 'BoNK11111111111111111111111111111111111111',
          amountRaw: 0n,
          decimals: 5,
        },
      ],
    });

    await expect(service.deleteMe('u_1')).resolves.toEqual({
      deleted: true,
    });
  });

  it('throws NotFoundException when smart_account missing', async () => {
    const { service } = makeService({ tokens: [], account: null });
    await expect(service.deleteMe('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses deletion while native SOL remains', () => {
    // Lamports are not a token account, so a SOL-only balance used to sail
    // past the guard and strand the funds behind an anonymized identity.
    const { service } = makeService({ tokens: [], lamports: 1n });
    return expect(service.deleteMe('u_1')).rejects.toBeInstanceOf(
      AccountHasBalanceError,
    );
  });
});
