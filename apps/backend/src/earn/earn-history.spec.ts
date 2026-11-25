import {
  clampEarned,
  earnedMinor,
  historyPoints,
  providerEarnings,
  rangeStartDay,
  weekAgoDay,
  snapshotsToRecord,
  totalEarnings,
  type EarnLedgerRow,
} from './earn-history';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);
const row = (
  provider: 'kamino' | 'jupiter',
  cash: string,
  shares: string,
  confirmedAt: Date | null = daysAgo(1),
  status = 'confirmed',
): EarnLedgerRow => ({
  provider,
  status,
  cashDeltaRaw: cash,
  shareDeltaRaw: shares,
  confirmedAt,
});

describe('clampEarned', () => {
  it('turns rounding dust below principal into zero and keeps real income', () => {
    expect(clampEarned(-1n)).toBe(0n);
    expect(clampEarned(0n)).toBe(0n);
    expect(clampEarned(30_000n)).toBe(30_000n);
    expect(earnedMinor('14999999', '15000000')).toBe('0');
    expect(earnedMinor('15030000', '15000000')).toBe('30000');
  });
});

describe('providerEarnings', () => {
  const rows = [
    row('jupiter', '-10000000', '9000000', daysAgo(20)),
    row('jupiter', '-5000000', '4500000', daysAgo(2)),
    row('jupiter', '3000000', '-2700000', daysAgo(1)),
    row('jupiter', '-999', '999', null, 'pending'),
    row('jupiter', '-999', '999', null, 'failed'),
    row('kamino', '-7000000', '7000000', daysAgo(3)),
  ];
  it('nets deposits against withdrawals for one provider only, ignoring unconfirmed rows', () => {
    expect(
      providerEarnings(
        rows,
        'jupiter',
        { shares: 10_800_000n, value: 12_100_000n },
        NOW,
      ),
    ).toEqual({
      lifetimeMinor: '100000',
      lastSevenDaysMinor: null,
      netDepositedMinor: '12000000',
    });
    expect(
      providerEarnings(
        rows,
        'kamino',
        { shares: 7_000_000n, value: 7_000_500n },
        NOW,
      ),
    ).toEqual({
      lifetimeMinor: '500',
      lastSevenDaysMinor: '500',
      netDepositedMinor: '7000000',
    });
  });
  it('clamps a fresh deposit valued one unit below principal', () => {
    expect(
      providerEarnings(
        rows,
        'kamino',
        { shares: 7_000_000n, value: 6_999_999n },
        NOW,
      ),
    ).toMatchObject({ lifetimeMinor: '0', lastSevenDaysMinor: '0' });
  });
  it('leaves earnings and principal unknown when the ledger does not explain the shares', () => {
    expect(
      providerEarnings(rows, 'kamino', { shares: 7_000_001n, value: 1n }, NOW),
    ).toEqual({
      lifetimeMinor: null,
      lastSevenDaysMinor: null,
      netDepositedMinor: null,
    });
  });
  it('reports a zero for a provider never used', () => {
    expect(
      providerEarnings([], 'kamino', { shares: 0n, value: 0n }, NOW),
    ).toEqual({
      lifetimeMinor: '0',
      lastSevenDaysMinor: '0',
      netDepositedMinor: '0',
    });
  });
});

describe('totalEarnings', () => {
  const known = {
    lifetimeMinor: '10',
    lastSevenDaysMinor: '10',
    netDepositedMinor: '0',
  };
  it('sums positions, and stays unknown when any position is unknown', () => {
    expect(totalEarnings({ kamino: known, jupiter: known })).toEqual({
      lifetimeMinor: '20',
      lastSevenDaysMinor: '20',
    });
    expect(
      totalEarnings({
        kamino: known,
        jupiter: { ...known, lastSevenDaysMinor: null },
      }),
    ).toEqual({ lifetimeMinor: '20', lastSevenDaysMinor: null });
  });
});

describe('snapshotsToRecord', () => {
  const earnings = {
    kamino: {
      lifetimeMinor: '0',
      lastSevenDaysMinor: '0',
      netDepositedMinor: '0',
    },
    jupiter: {
      lifetimeMinor: '5',
      lastSevenDaysMinor: '5',
      netDepositedMinor: '100',
    },
  };
  it('records held positions and the final zero day of a withdrawn one', () => {
    expect(
      snapshotsToRecord(
        { kamino: { value: 0n }, jupiter: { value: 105n } },
        earnings,
        new Set(),
      ),
    ).toEqual([
      { provider: 'jupiter', valueMinor: '105', netDepositedMinor: '100' },
    ]);
    expect(
      snapshotsToRecord(
        { kamino: { value: 0n }, jupiter: { value: 105n } },
        earnings,
        new Set(['kamino'] as const),
      ),
    ).toEqual([
      { provider: 'kamino', valueMinor: '0', netDepositedMinor: '0' },
      { provider: 'jupiter', valueMinor: '105', netDepositedMinor: '100' },
    ]);
  });
  it('skips a position whose principal is unknown', () => {
    expect(
      snapshotsToRecord(
        { kamino: { value: 0n }, jupiter: { value: 105n } },
        {
          ...earnings,
          jupiter: { ...earnings.jupiter, netDepositedMinor: null },
        },
        new Set(),
      ),
    ).toEqual([]);
  });
});

describe('rangeStartDay', () => {
  const now = new Date('2026-11-25T23:59:00Z');
  it('counts today as the last day of the range, in UTC', () => {
    expect(rangeStartDay('7d', now)).toBe('2026-11-19');
    expect(rangeStartDay('30d', now)).toBe('2026-10-27');
    expect(rangeStartDay('1y', now)).toBe('2025-11-26');
    expect(rangeStartDay('all', now)).toBeNull();
  });
});

describe('historyPoints', () => {
  it('orders by day and derives cumulative earnings', () => {
    expect(
      historyPoints([
        {
          day: '2026-11-25',
          valueMinor: '15030000',
          netDepositedMinor: '15000000',
        },
        { day: '2026-11-01', valueMinor: '0', netDepositedMinor: '-20' },
        {
          day: '2026-11-10',
          valueMinor: '15000000',
          netDepositedMinor: '15000000',
        },
      ]),
    ).toEqual([
      { day: '2026-11-01', valueMinor: '0', earnedMinor: '20' },
      { day: '2026-11-10', valueMinor: '15000000', earnedMinor: '0' },
      { day: '2026-11-25', valueMinor: '15030000', earnedMinor: '30000' },
    ]);
  });
});

describe('seven-day earnings from snapshots', () => {
  const old = [row('jupiter', '-10000000', '10000000', daysAgo(30))];
  const position = { shares: 10_000_000n, value: 10_050_000n };
  const snap = (day: string, value: string, net = '10000000') => ({
    day,
    valueMinor: value,
    netDepositedMinor: net,
  });
  it('measures from the latest snapshot on or before seven days ago', () => {
    expect(
      providerEarnings(old, 'jupiter', position, NOW, {
        weekAgo: snap('2026-11-18', '10030000'),
        earliest: snap('2026-10-26', '10000000'),
      }),
    ).toMatchObject({ lifetimeMinor: '50000', lastSevenDaysMinor: '20000' });
  });
  it('counts a deposit made since the baseline as principal, not income', () => {
    const rows = [...old, row('jupiter', '-5000000', '5000000', daysAgo(2))];
    expect(
      providerEarnings(
        rows,
        'jupiter',
        { shares: 15_000_000n, value: 15_050_000n },
        NOW,
        { weekAgo: snap('2026-11-18', '10030000'), earliest: null },
      ),
    ).toMatchObject({ lifetimeMinor: '50000', lastSevenDaysMinor: '20000' });
  });
  it('clamps at zero when the baseline earned more than today', () => {
    expect(
      providerEarnings(old, 'jupiter', position, NOW, {
        weekAgo: snap('2026-11-18', '10060000'),
        earliest: null,
      }),
    ).toMatchObject({ lastSevenDaysMinor: '0' });
  });
  it('keeps all lifetime earnings for a position younger than the window', () => {
    const young = [row('jupiter', '-10000000', '10000000', daysAgo(3))];
    expect(
      providerEarnings(young, 'jupiter', position, NOW, {
        weekAgo: null,
        earliest: snap('2026-11-23', '10010000'),
      }),
    ).toMatchObject({ lastSevenDaysMinor: '50000' });
  });
  it('falls back to the earliest snapshot for an older position whose history starts later', () => {
    expect(
      providerEarnings(old, 'jupiter', position, NOW, {
        weekAgo: null,
        earliest: snap('2026-11-22', '10040000'),
      }),
    ).toMatchObject({ lifetimeMinor: '50000', lastSevenDaysMinor: '10000' });
  });
  it('stays unknown with no snapshot at all for an older position, and on share mismatch', () => {
    expect(providerEarnings(old, 'jupiter', position, NOW)).toMatchObject({
      lastSevenDaysMinor: null,
    });
    expect(
      providerEarnings(old, 'jupiter', { shares: 1n, value: 1n }, NOW, {
        weekAgo: snap('2026-11-18', '0'),
        earliest: null,
      }),
    ).toEqual({
      lifetimeMinor: null,
      lastSevenDaysMinor: null,
      netDepositedMinor: null,
    });
  });
  it('sums the per-position seven-day figures into the total', () => {
    const kamino = providerEarnings(
      [],
      'kamino',
      { shares: 0n, value: 0n },
      NOW,
    );
    const jupiter = providerEarnings(old, 'jupiter', position, NOW, {
      weekAgo: snap('2026-11-18', '10030000'),
      earliest: null,
    });
    expect(totalEarnings({ kamino, jupiter })).toEqual({
      lifetimeMinor: '50000',
      lastSevenDaysMinor: '20000',
    });
  });
  it('names the UTC day seven days ago', () => {
    expect(weekAgoDay(NOW)).toBe('2026-11-18');
  });
});
