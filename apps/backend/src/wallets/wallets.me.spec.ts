import { NotFoundException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import type { DbService } from '../db/db.service';
import type { ConfigService } from '@nestjs/config';
import type { SolanaRpc, TokenBalance } from '../solana/solana-rpc.interface';
import type {
  TokenPrice,
  TokenPriceProvider,
} from '../prices/token-price.interface';
import type { TokenMetadataProvider } from '../tokens/token-metadata.interface';
import { smartAccounts } from '../db/schema';

/**
 * Integration tests for WalletsService.getMe and getMeBalances (mounted
 * at /wallet/me and /wallet/me/balances).
 *
 * The DB is a minimal in-memory stub: each test seeds at most one row,
 * and drizzle's opaque `eq()` predicates are treated as match-all by the
 * fake. The SolanaRpc seam is stubbed per-test to assert the consuming
 * service sees a single coherent SolanaRpc and never depends on which
 * adapter served the read (FailoverSolanaRpc's own fallback logic is
 * unit-tested in failover-solana-rpc.spec.ts).
 */

type SmartAccountsRow = typeof smartAccounts.$inferSelect;

interface FakeStore {
  smartAccounts: SmartAccountsRow[];
}

function makeFakeDb(store: FakeStore): DbService {
  const makeSelectChain = () => {
    const ctx: { limit?: number } = {};
    const execute = () => {
      let rows = store.smartAccounts.slice();
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
      from: () => makeSelectChain(),
    }),
  };
  return { client } as unknown as DbService;
}

function makeService(opts: {
  solana: SolanaRpc;
  account?: SmartAccountsRow | null;
  /** USD price per whole token, by mint. Stablecoins never reach this. */
  prices?: Record<string, number>;
  /** Names and logos by mint, as the token index would return them. */
  metadata?: Record<string, { name: string; symbol: string; iconUrl: string }>;
}): { service: WalletsService; store: FakeStore } {
  const store: FakeStore = {
    smartAccounts:
      opts.account === null || opts.account === undefined ? [] : [opts.account],
  };
  if (opts.account === undefined) {
    // Default seeded account
    store.smartAccounts.push({
      id: 'sa_1',
      userId: 'u_1',
      walletAddress: 'SoLAnAaDdRess111111111111111111111111111111',
      provider: 'privy',
      providerUserId: 'did:privy:abc',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  const db = makeFakeDb(store);
  const service = new WalletsService(
    db,
    opts.solana,
    fakePrices(opts.prices),
    fakeMetadata(opts.metadata),
    fakeConfig(),
  );
  return { service, store };
}

/** Only the stablecoin mints matter here; everything else is priced. */
function fakeConfig(): ConfigService {
  return {
    getOrThrow: () => usdcMint,
    get: () => usdtMint,
  } as unknown as ConfigService;
}

function fakeMetadata(
  metadata?: Record<string, { name: string; symbol: string; iconUrl: string }>,
): TokenMetadataProvider {
  return {
    getMetadata: jest
      .fn()
      .mockResolvedValue(new Map(Object.entries(metadata ?? {}))),
  } as unknown as TokenMetadataProvider;
}

/**
 * Stands in for the real provider, which pins stablecoins to a dollar before
 * quoting anything else. Pinned here too, so these tests describe the
 * behaviour the service actually sees.
 */
function fakePrices(prices?: Record<string, number>): TokenPriceProvider {
  const entries: [string, TokenPrice][] = [usdcMint, usdtMint].map((mint) => [
    mint,
    { usdPrice: 1, priceChange24h: null, decimals: 6 },
  ]);
  for (const [mint, usdPrice] of Object.entries(prices ?? {})) {
    entries.push([mint, { usdPrice, priceChange24h: 5.13, decimals: null }]);
  }
  return {
    getUsdPrices: jest.fn().mockResolvedValue(new Map(entries)),
  } as unknown as TokenPriceProvider;
}

const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const usdtMint = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const wrappedSolMint = 'So11111111111111111111111111111111111111112';

describe('WalletsService (/wallet/me + /wallet/me/balances)', () => {
  describe('getMe', () => {
    it('returns walletAddress + provider literal', async () => {
      const solana = {
        getSolBalance: jest.fn().mockResolvedValue(0n),
        getTokenBalances: jest.fn(),
        getRecentBlockhash: jest.fn(),
      } as unknown as SolanaRpc;
      const { service } = makeService({ solana });
      const result = await service.getMe('u_1');
      expect(result).toEqual({
        walletAddress: 'SoLAnAaDdRess111111111111111111111111111111',
        provider: 'privy',
      });
    });

    it('throws NotFoundException when smart_account missing', async () => {
      const solana = {
        getSolBalance: jest.fn().mockResolvedValue(0n),
        getTokenBalances: jest.fn(),
        getRecentBlockhash: jest.fn(),
      } as unknown as SolanaRpc;
      const { service } = makeService({ solana, account: null });
      await expect(service.getMe('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getMeBalances', () => {
    it('returns empty tokens for a wallet with no token accounts', async () => {
      const getTokenBalances = jest
        .fn<Promise<TokenBalance[]>, [string]>()
        .mockResolvedValue([]);
      const getRecentBlockhash = jest
        .fn()
        .mockResolvedValue({ blockhash: 'bh-1', lastValidBlockHeight: 100 });
      const solana = {
        getSolBalance: jest.fn().mockResolvedValue(0n),
        getTokenBalances,
        getRecentBlockhash,
      } as unknown as SolanaRpc;
      const { service } = makeService({ solana });

      const result = await service.getMeBalances('u_1');

      expect(result.tokens).toEqual([]);
      expect(result.walletAddress).toBe(
        'SoLAnAaDdRess111111111111111111111111111111',
      );
      expect(result.fetchedAtSlot).toBe(100);
      expect(getTokenBalances).toHaveBeenCalledWith(
        'SoLAnAaDdRess111111111111111111111111111111',
      );
    });

    it('reports native SOL, which owns no token account to be read from', async () => {
      const getTokenBalances = jest
        .fn<Promise<TokenBalance[]>, [string]>()
        .mockResolvedValue([]);
      const getRecentBlockhash = jest
        .fn()
        .mockResolvedValue({ blockhash: 'bh-sol', lastValidBlockHeight: 300 });
      const solana = {
        getSolBalance: jest.fn().mockResolvedValue(5_000_000_000n),
        getTokenBalances,
        getRecentBlockhash,
      } as unknown as SolanaRpc;
      const { service } = makeService({
        solana,
        prices: { [wrappedSolMint]: 80 },
      });

      const result = await service.getMeBalances('u_1');

      expect(result.tokens).toEqual([
        {
          mint: wrappedSolMint,
          amountRaw: '5000000000',
          decimals: 9,
          symbol: 'SOL',
          usdValue: 400,
          usdPrice: 80,
          priceChange24h: 5.13,
          name: null,
          iconUrl: null,
        },
      ]);
    });

    it('sums native SOL with a wrapped-SOL account into one holding', async () => {
      // Two rows for the same mint is not something a Consumer can act on.
      const getTokenBalances = jest.fn().mockResolvedValue([
        { mint: usdcMint, amountRaw: 1_000_000n, decimals: 6 },
        { mint: wrappedSolMint, amountRaw: 2_000_000_000n, decimals: 9 },
      ]);
      const getRecentBlockhash = jest
        .fn()
        .mockResolvedValue({ blockhash: 'bh-sol2', lastValidBlockHeight: 400 });
      const solana = {
        getSolBalance: jest.fn().mockResolvedValue(3_000_000_000n),
        getTokenBalances,
        getRecentBlockhash,
      } as unknown as SolanaRpc;
      const { service } = makeService({
        solana,
        prices: { [wrappedSolMint]: 80 },
      });

      const result = await service.getMeBalances('u_1');

      const sol = result.tokens.filter((t) => t.mint === wrappedSolMint);
      expect(sol).toEqual([
        {
          mint: wrappedSolMint,
          amountRaw: '5000000000',
          decimals: 9,
          symbol: 'SOL',
          usdValue: 400,
          usdPrice: 80,
          priceChange24h: 5.13,
          name: null,
          iconUrl: null,
        },
      ]);
    });

    it('omits SOL entirely when the account holds none', async () => {
      const getTokenBalances = jest
        .fn<Promise<TokenBalance[]>, [string]>()
        .mockResolvedValue([
          { mint: usdcMint, amountRaw: 1_000_000n, decimals: 6 },
        ]);
      const getRecentBlockhash = jest
        .fn()
        .mockResolvedValue({ blockhash: 'bh-sol3', lastValidBlockHeight: 500 });
      const solana = {
        getSolBalance: jest.fn().mockResolvedValue(0n),
        getTokenBalances,
        getRecentBlockhash,
      } as unknown as SolanaRpc;
      const { service } = makeService({ solana });

      const result = await service.getMeBalances('u_1');

      expect(result.tokens.map((t) => t.mint)).toEqual([usdcMint]);
    });

    it('leaves holdings unpriced when the price provider is down', async () => {
      // The balance itself is on-chain fact. A third party having a bad day
      // must not blank it, and must not report the holding as worthless.
      const getTokenBalances = jest
        .fn<Promise<TokenBalance[]>, [string]>()
        .mockResolvedValue([]);
      const getRecentBlockhash = jest
        .fn()
        .mockResolvedValue({ blockhash: 'bh-down', lastValidBlockHeight: 600 });
      const solana = {
        getSolBalance: jest.fn().mockResolvedValue(5_000_000_000n),
        getTokenBalances,
        getRecentBlockhash,
      } as unknown as SolanaRpc;
      const db = makeFakeDb({
        smartAccounts: [
          {
            id: 'sa_1',
            userId: 'u_1',
            walletAddress: 'SoLAnAaDdRess111111111111111111111111111111',
            provider: 'privy',
            providerUserId: 'did:privy:abc',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });
      const service = new WalletsService(
        db,
        solana,
        {
          getUsdPrices: jest.fn().mockRejectedValue(new Error('jup 503')),
        } as unknown as TokenPriceProvider,
        fakeMetadata(),
        {
          getOrThrow: () => usdcMint,
          get: () => usdtMint,
        } as unknown as ConfigService,
      );

      const result = await service.getMeBalances('u_1');

      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].mint).toBe(wrappedSolMint);
      expect(result.tokens[0].amountRaw).toBe('5000000000');
      expect(result.tokens[0].usdValue).toBeNull();
    });

    it('returns the full multi-mint list without server-side filtering', async () => {
      // USDC + USDT + a random SPL — all should pass through. The mobile
      // filter for the headline Balance lives client-side.
      const tokens: TokenBalance[] = [
        { mint: usdcMint, amountRaw: 1_500_000n, decimals: 6 },
        { mint: usdtMint, amountRaw: 250_000n, decimals: 6 },
        {
          mint: 'BoNK11111111111111111111111111111111111111',
          amountRaw: 999_999_999_999n,
          decimals: 5,
        },
      ];
      const getTokenBalances = jest.fn().mockResolvedValue(tokens);
      const getRecentBlockhash = jest
        .fn()
        .mockResolvedValue({ blockhash: 'bh-2', lastValidBlockHeight: 200 });
      const solana = {
        getSolBalance: jest.fn().mockResolvedValue(0n),
        getTokenBalances,
        getRecentBlockhash,
      } as unknown as SolanaRpc;
      const { service } = makeService({ solana });

      const result = await service.getMeBalances('u_1');

      expect(result.tokens).toHaveLength(3);
      expect(result.tokens[0]).toEqual({
        mint: usdcMint,
        amountRaw: '1500000',
        decimals: 6,
        symbol: null,
        // Pinned, not quoted: a stablecoin balance has to read exactly.
        usdValue: 1.5,
        usdPrice: 1,
        // A pinned dollar reports no movement, which is not zero movement.
        priceChange24h: null,
        name: null,
        iconUrl: null,
      });
      expect(result.tokens[1]).toEqual({
        mint: usdtMint,
        amountRaw: '250000',
        decimals: 6,
        symbol: null,
        usdValue: 0.25,
        usdPrice: 1,
        priceChange24h: null,
        name: null,
        iconUrl: null,
      });
      // Non-stablecoin still present, and unpriced rather than zeroed: no
      // price was supplied for it.
      expect(result.tokens[2].mint).toBe(
        'BoNK11111111111111111111111111111111111111',
      );
      expect(result.tokens[2].usdValue).toBeNull();
      expect(result.fetchedAtSlot).toBe(200);
    });

    it('helius outage falls back to public-RPC transparently (consumer sees one SolanaRpc)', async () => {
      // In production SOLANA_RPC resolves to FailoverSolanaRpc (Helius
      // primary, public-mainnet fallback). The stub models that as a
      // single opaque SolanaRpc seam: the service sees one resolved
      // promise regardless of which adapter served the read.
      const fallbackTokens: TokenBalance[] = [
        { mint: usdcMint, amountRaw: 42n, decimals: 6 },
      ];
      let getTokenBalancesCalls = 0;
      const getTokenBalances = jest
        .fn<Promise<TokenBalance[]>, [string]>()
        .mockImplementation(() => {
          getTokenBalancesCalls += 1;
          return Promise.resolve(fallbackTokens);
        });
      const getRecentBlockhash = jest
        .fn()
        .mockResolvedValue({ blockhash: 'bh-3', lastValidBlockHeight: 300 });
      const solana = {
        getSolBalance: jest.fn().mockResolvedValue(0n),
        getTokenBalances,
        getRecentBlockhash,
      } as unknown as SolanaRpc;
      const { service } = makeService({ solana });

      const result = await service.getMeBalances('u_1');

      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].amountRaw).toBe('42');
      expect(getTokenBalancesCalls).toBe(1);
    });

    it('throws NotFoundException when smart_account missing', async () => {
      const solana = {
        getSolBalance: jest.fn().mockResolvedValue(0n),
        getTokenBalances: jest.fn(),
        getRecentBlockhash: jest.fn(),
      } as unknown as SolanaRpc;
      const { service } = makeService({ solana, account: null });
      await expect(service.getMeBalances('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
