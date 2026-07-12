import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import type { SolanaRpc, TokenBalance } from '../solana/solana-rpc.interface';
import type {
  CounterSnapshot,
  RateCounter,
} from '../counters/rate-counter.interface';
import { smartAccounts } from '../db/schema';
import { CapacityService } from './capacity.service';

type SmartAccountsRow = typeof smartAccounts.$inferSelect;

const USDC = 'UsdcMint111';

const account: SmartAccountsRow = {
  id: 'sa1',
  userId: 'c1',
  walletAddress: 'Wallet1111',
  provider: 'privy',
  providerUserId: 'p1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

function makeFakeDb(accounts: SmartAccountsRow[]): DbService {
  const chain = {
    where: () => chain,
    limit: () => Promise.resolve(accounts),
  };
  const client = {
    select: () => ({ from: () => chain }),
  };
  return { client } as unknown as DbService;
}

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    CAPACITY_TIERS:
      '{"tier0":{"perPaymentMaxRaw":"50000000","dailyCapRaw":"200000000","monthlyCapRaw":"1000000000"}}',
    CAPACITY_DEFAULT_TIER: 'tier0',
    EXPO_PUBLIC_USDC_MINT_ADDRESS: USDC,
    ...overrides,
  };
  return {
    getOrThrow: (key: string): string => {
      const v = values[key];
      if (v === undefined) throw new Error(`missing config ${key}`);
      return v;
    },
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
}

function makeSolana(balances: TokenBalance[]): SolanaRpc {
  return {
    getTokenBalances: jest.fn().mockResolvedValue(balances),
  } as unknown as SolanaRpc;
}

function makeCounter(day: CounterSnapshot, month: CounterSnapshot) {
  const increments: { key: string; amountRaw: string }[] = [];
  const counter = {
    peek: jest.fn((key: string) =>
      Promise.resolve(key.includes(':day:') ? day : month),
    ),
    increment: jest.fn((key: string, amountRaw: string) => {
      increments.push({ key, amountRaw });
      return Promise.resolve({ count: 1, totalRaw: amountRaw });
    }),
    clear: jest.fn(() => Promise.resolve()),
  } as unknown as RateCounter;
  return { counter, increments };
}

function makeService(
  opts: {
    accounts?: SmartAccountsRow[];
    balances?: TokenBalance[];
    day?: CounterSnapshot;
    month?: CounterSnapshot;
    config?: Record<string, string>;
  } = {},
) {
  const db = makeFakeDb(opts.accounts ?? [account]);
  const config = makeConfig(opts.config);
  const solana = makeSolana(
    opts.balances ?? [
      { mint: USDC, amountRaw: 100_000_000n, decimals: 6 },
      { mint: 'OtherMint', amountRaw: 999_000_000n, decimals: 6 },
    ],
  );
  const { counter, increments } = makeCounter(
    opts.day ?? { count: 0, totalRaw: '0' },
    opts.month ?? { count: 0, totalRaw: '0' },
  );
  const service = new CapacityService(db, config, solana, counter);
  service.onModuleInit();
  return { service, increments, solana, counter };
}

describe('CapacityService.checkCapacity', () => {
  it('passes an amount within caps and returns capability with boost null', async () => {
    const { service } = makeService();
    const cap = await service.checkCapacity('c1', '50000000');
    expect(cap.tier).toBe('tier0');
    // Only the USDC mint is summed; the non-USDC mint is filtered out.
    expect(cap.balanceRaw).toBe('100000000');
    expect(cap.boost).toBeNull();
    expect(cap.riskFlags).toEqual([]);
    expect(cap.limits.perPaymentMaxRaw).toBe('50000000');
  });

  it('rejects an over-per-payment amount with PER_PAYMENT_CAP', async () => {
    const { service } = makeService();
    await expect(service.checkCapacity('c1', '50000001')).rejects.toMatchObject(
      { code: 'CAPACITY_EXCEEDED', reason: 'PER_PAYMENT_CAP' },
    );
  });

  it('counts prior daily usage toward the daily cap', async () => {
    const { service } = makeService({
      day: { count: 4, totalRaw: '180000000' },
    });
    await expect(service.checkCapacity('c1', '30000000')).rejects.toMatchObject(
      { code: 'CAPACITY_EXCEEDED', reason: 'DAILY_CAP' },
    );
  });

  it('counts prior monthly usage toward the monthly cap', async () => {
    const { service } = makeService({
      month: { count: 30, totalRaw: '990000000' },
    });
    await expect(service.checkCapacity('c1', '30000000')).rejects.toMatchObject(
      { code: 'CAPACITY_EXCEEDED', reason: 'MONTHLY_CAP' },
    );
  });

  it('rejects when the amount exceeds live balance', async () => {
    const { service } = makeService({
      balances: [{ mint: USDC, amountRaw: 10_000_000n, decimals: 6 }],
    });
    await expect(service.checkCapacity('c1', '50000000')).rejects.toMatchObject(
      { code: 'INSUFFICIENT_BALANCE' },
    );
  });

  it('rejects an unknown consumer with UNKNOWN_CONSUMER', async () => {
    const { service } = makeService({ accounts: [] });
    await expect(service.checkCapacity('ghost', '1')).rejects.toMatchObject({
      code: 'UNKNOWN_CONSUMER',
    });
  });
});

describe('CapacityService.recordAuthorizedPayment', () => {
  it('increments both the day and month counters', async () => {
    const { service, increments } = makeService();
    await service.recordAuthorizedPayment('c1', '50000000');
    expect(increments).toHaveLength(2);
    expect(increments[0].key).toContain(':day:');
    expect(increments[0].amountRaw).toBe('50000000');
    expect(increments[1].key).toContain(':month:');
    expect(increments[1].amountRaw).toBe('50000000');
  });
});

describe('CapacityService.onModuleInit', () => {
  it('throws on malformed CAPACITY_TIERS JSON', () => {
    expect(() =>
      makeService({ config: { CAPACITY_TIERS: 'not json' } }),
    ).toThrow();
  });

  it('throws when the default tier is absent from the table', () => {
    expect(() =>
      makeService({
        config: {
          CAPACITY_TIERS:
            '{"tierX":{"perPaymentMaxRaw":"1","dailyCapRaw":"2","monthlyCapRaw":"3"}}',
          CAPACITY_DEFAULT_TIER: 'tier0',
        },
      }),
    ).toThrow(/missing from CAPACITY_TIERS/);
  });

  it('throws when the USDC mint is empty', () => {
    expect(() =>
      makeService({ config: { EXPO_PUBLIC_USDC_MINT_ADDRESS: '' } }),
    ).toThrow(/EXPO_PUBLIC_USDC_MINT_ADDRESS/);
  });
});
