import { NotFoundException } from '@nestjs/common';
import { AccountHasBalanceError, WalletsService } from './wallets.service';
import type { DbService } from '../db/db.service';
import type { SolanaRpc, TokenBalance } from '../solana/solana-rpc.interface';
import { smartAccounts, users } from '../db/schema';

/**
 * Integration tests for WalletsService.deleteMe (mounted at DELETE
 * /wallet/me). The fake DB models `select().from(smartAccounts)` as
 * match-all (same posture as wallets.me.spec.ts) and tracks `update(users)`
 * calls against the seeded store so assertions can inspect what actually
 * got written.
 */

type SmartAccountsRow = typeof smartAccounts.$inferSelect;
type UsersRow = typeof users.$inferSelect;

interface FakeStore {
  smartAccounts: SmartAccountsRow[];
  users: UsersRow[];
}

function makeFakeDb(store: FakeStore): DbService {
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
          if (tbl === users) {
            store.users = store.users.map((u) => ({ ...u, ...values }));
          }
          if (tbl === smartAccounts) {
            store.smartAccounts = store.smartAccounts.map((a) => ({
              ...a,
              ...values,
            }));
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return { client } as unknown as DbService;
}

function makeService(opts: {
  tokens: TokenBalance[];
  account?: SmartAccountsRow | null;
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
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        deletedAt: null,
      },
    ],
  };
  const db = makeFakeDb(store);
  const solana = {
    getTokenBalances: jest
      .fn<Promise<TokenBalance[]>, [string]>()
      .mockResolvedValue(opts.tokens),
    getRecentBlockhash: jest.fn(),
  } as unknown as SolanaRpc;
  const service = new WalletsService(db, solana);
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
    expect(store.users[0].email).toBe('deleted-u_1@deleted.xend.internal');
    // Frees the unique wallet_address/provider_user_id so /auth/exchange can
    // re-insert a smart_accounts row if the same Privy identity signs in
    // again later, instead of hitting a stale unique-constraint conflict.
    expect(store.smartAccounts[0].walletAddress).toBe('deleted-sa_1');
    expect(store.smartAccounts[0].providerUserId).toBe('deleted-sa_1');
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
});
