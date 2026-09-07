import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import type { SolanaRpc, TokenBalance } from '../solana/solana-rpc.interface';
import type {
  CounterSnapshot,
  ReservingRateCounter,
} from '../counters/rate-counter.interface';
import { CapacityService } from './capacity.service';

const USDC = 'UsdcMint111';
const VAULT = 'Vault11111';

/** What findVaultAddress selects: the vault, and nothing else. */
const account = { vaultAddress: VAULT };

function makeFakeDb(accounts: { vaultAddress: string }[]): DbService {
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
    getSolBalance: jest.fn().mockResolvedValue(0n),
    getTokenBalances: jest.fn().mockResolvedValue(balances),
  } as unknown as SolanaRpc;
}

/**
 * In-memory counter with the same atomic reserve semantics as the Redis Lua
 * script: add, compare against the cap, roll back on overshoot. Windows are
 * seeded from `day` and `month` and then move with every reservation.
 */
function makeCounter(day: CounterSnapshot, month: CounterSnapshot) {
  const totals = new Map<string, bigint>();
  const counts = new Map<string, number>();
  const seed = (key: string) => {
    if (!totals.has(key)) {
      const snap = key.includes(':day:') ? day : month;
      totals.set(key, BigInt(snap.totalRaw));
      counts.set(key, snap.count);
    }
  };
  const snapshot = (key: string): CounterSnapshot => ({
    count: counts.get(key) ?? 0,
    totalRaw: (totals.get(key) ?? 0n).toString(),
  });
  const reservations: { key: string; amountRaw: string }[] = [];
  const releases: { key: string; amountRaw: string }[] = [];
  const counter = {
    peek: jest.fn((key: string) => {
      seed(key);
      return Promise.resolve(snapshot(key));
    }),
    reserve: jest.fn((key: string, amountRaw: string, capRaw: string) => {
      seed(key);
      const next = totals.get(key)! + BigInt(amountRaw);
      if (next > BigInt(capRaw)) {
        return Promise.resolve({ allowed: false, snapshot: snapshot(key) });
      }
      totals.set(key, next);
      counts.set(key, counts.get(key)! + 1);
      reservations.push({ key, amountRaw });
      return Promise.resolve({ allowed: true, snapshot: snapshot(key) });
    }),
    release: jest.fn((key: string, amountRaw: string) => {
      seed(key);
      totals.set(key, totals.get(key)! - BigInt(amountRaw));
      counts.set(key, counts.get(key)! - 1);
      releases.push({ key, amountRaw });
      return Promise.resolve();
    }),
    increment: jest.fn(),
    clear: jest.fn(() => Promise.resolve()),
  } as unknown as ReservingRateCounter;
  return { counter, reservations, releases, snapshot };
}

function makeService(
  opts: {
    accounts?: { vaultAddress: string }[];
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
  const { counter, reservations, releases, snapshot } = makeCounter(
    opts.day ?? { count: 0, totalRaw: '0' },
    opts.month ?? { count: 0, totalRaw: '0' },
  );
  const service = new CapacityService(db, config, solana, counter);
  service.onModuleInit();
  return { service, reservations, releases, snapshot, solana, counter };
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

describe('CapacityService.reserveCapacity', () => {
  it('reserves both the day and month windows and returns the spent snapshot', async () => {
    const { service, reservations } = makeService({
      day: { count: 1, totalRaw: '10000000' },
    });
    const cap = await service.reserveCapacity('c1', '50000000');
    expect(reservations).toHaveLength(2);
    expect(reservations[0].key).toContain(':day:');
    expect(reservations[0].amountRaw).toBe('50000000');
    expect(reservations[1].key).toContain(':month:');
    expect(reservations[1].amountRaw).toBe('50000000');
    expect(cap.usedTodayRaw).toBe('60000000');
    expect(cap.usedThisMonthRaw).toBe('50000000');
  });

  it('refuses at the daily cap and leaves both windows untouched', async () => {
    const { service, reservations, releases } = makeService({
      day: { count: 4, totalRaw: '180000000' },
    });
    await expect(
      service.reserveCapacity('c1', '30000000'),
    ).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED', reason: 'DAILY_CAP' });
    expect(reservations).toHaveLength(0);
    expect(releases).toHaveLength(0);
  });

  it('gives the day reservation back when the month window refuses', async () => {
    const { service, reservations, releases, snapshot } = makeService({
      month: { count: 30, totalRaw: '990000000' },
    });
    await expect(
      service.reserveCapacity('c1', '30000000'),
    ).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED',
      reason: 'MONTHLY_CAP',
    });
    expect(reservations).toHaveLength(1);
    expect(releases).toHaveLength(1);
    expect(releases[0].key).toBe(reservations[0].key);
    expect(snapshot(reservations[0].key).totalRaw).toBe('0');
  });

  it('never lets concurrent reservations add up past the daily cap', async () => {
    // Daily cap 200 USDC, headroom for exactly four 50 USDC Payments.
    const { service, snapshot, reservations } = makeService();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.reserveCapacity('c1', '50000000'),
      ),
    );
    const allowed = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(allowed).toHaveLength(4);
    expect(refused).toHaveLength(6);
    for (const r of refused) {
      expect(r.reason).toMatchObject({
        reason: 'DAILY_CAP',
      });
    }
    const dayKey = reservations.find((r) => r.key.includes(':day:'))!.key;
    expect(snapshot(dayKey).totalRaw).toBe('200000000');
  });

  it('still refuses per-payment and balance before touching a window', async () => {
    const { service, reservations } = makeService({
      balances: [{ mint: USDC, amountRaw: 10_000_000n, decimals: 6 }],
    });
    await expect(
      service.reserveCapacity('c1', '50000000'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await expect(
      service.reserveCapacity('c1', '50000001'),
    ).rejects.toMatchObject({ reason: 'PER_PAYMENT_CAP' });
    expect(reservations).toHaveLength(0);
  });
});

describe('CapacityService.releaseCapacity', () => {
  it('releases both windows by the reserved amount', async () => {
    const { service, releases, reservations, snapshot } = makeService();
    await service.reserveCapacity('c1', '50000000');
    await service.releaseCapacity('c1', '50000000');
    expect(releases.map((r) => r.key)).toEqual(reservations.map((r) => r.key));
    expect(snapshot(reservations[0].key)).toEqual({ count: 0, totalRaw: '0' });
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
