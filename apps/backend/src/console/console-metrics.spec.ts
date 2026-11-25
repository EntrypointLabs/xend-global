import type { DbService } from '../db/db.service';
import {
  ConsoleMetricsService,
  TREND_DAYS,
  trendDays,
} from './console-metrics.service';
import { formatUsd, renderMetrics, splitUsd } from './console-metrics-html';

const NOW = new Date('2026-11-25T12:00:00Z');

/** A db whose two aggregate queries resolve, in order, to the given rows. */
function makeDb(volumeRows: unknown[], counts: Record<string, number>) {
  const results = [{ rows: volumeRows }, { rows: [counts] }];
  const client = { execute: () => Promise.resolve(results.shift()) };
  return { client } as unknown as DbService;
}

const COUNTS = {
  users: 40,
  recent_users: 6,
  accounts: 31,
  merchants: 2,
  active: 12,
};

describe('trendDays', () => {
  it('ends on the current UTC day and reaches back a full window', () => {
    const days = trendDays(NOW);
    expect(days).toHaveLength(TREND_DAYS);
    expect(days[0]).toBe('2026-10-27');
    expect(days[days.length - 1]).toBe('2026-11-25');
  });
});

describe('ConsoleMetricsService', () => {
  it('sums the products into the total and keeps deposits out of it', async () => {
    const service = new ConsoleMetricsService(
      makeDb(
        [
          { product: 'send', day: '2026-11-20', cents: '10000', n: 2 },
          { product: 'send', day: '2026-06-01', cents: '5000', n: 1 },
          { product: 'swap', day: '2026-11-20', cents: '20100', n: 1 },
          { product: 'deposit', day: '2026-11-11', cents: '50000', n: 1 },
        ],
        COUNTS,
      ),
    );

    const metrics = await service.load(NOW);

    expect(metrics.volume.totalCents).toBe(35100n);
    expect(metrics.volume.recentCents).toBe(30100n);
    expect(metrics.volume.count).toBe(4);
    expect(metrics.products.send).toEqual({
      totalCents: 15000n,
      recentCents: 10000n,
      count: 3,
      recentCount: 2,
    });
    expect(metrics.products.pay.totalCents).toBe(0n);
    expect(metrics.deposits.totalCents).toBe(50000n);
    expect(metrics.users).toEqual({
      total: 40,
      recent: 6,
      accounts: 31,
      active: 12,
      merchants: 2,
    });
  });

  it('fills every day of the window, including the ones nothing happened on', async () => {
    const service = new ConsoleMetricsService(
      makeDb(
        [
          { product: 'send', day: '2026-11-20', cents: '10000', n: 1 },
          { product: 'earn', day: '2026-11-20', cents: '2500', n: 1 },
          { product: 'deposit', day: '2026-11-21', cents: '99900', n: 1 },
          { product: 'send', day: '2026-06-01', cents: '5000', n: 1 },
        ],
        COUNTS,
      ),
    );

    const { daily } = await service.load(NOW);

    expect(daily).toHaveLength(TREND_DAYS);
    expect(daily.find((d) => d.day === '2026-11-20')?.cents).toBe(12500n);
    expect(daily.find((d) => d.day === '2026-11-21')?.cents).toBe(0n);
    expect(daily.reduce((sum, d) => sum + d.cents, 0n)).toBe(12500n);
  });
});

describe('metrics formatting', () => {
  it('groups thousands and always shows two decimals', () => {
    expect(formatUsd(128433042n)).toBe('$1,284,330.42');
    expect(formatUsd(5n)).toBe('$0.05');
    expect(splitUsd(100000n)).toEqual({ whole: '$1,000', fraction: '00' });
  });
});

describe('renderMetrics', () => {
  it('renders the headline, each product and an empty-window note', async () => {
    const service = new ConsoleMetricsService(
      makeDb(
        [{ product: 'pay', day: '2026-01-05', cents: '123456', n: 3 }],
        COUNTS,
      ),
    );

    const html = renderMetrics(await service.load(NOW));

    expect(html).toContain('$1,234<span class="cents">.56</span>');
    expect(html).toContain('Pay payments');
    expect(html).toContain('Naira ramps');
    expect(html).toContain(`No volume in the last ${TREND_DAYS} days`);
    expect(html.match(/<rect/g)).toHaveLength(TREND_DAYS);
  });
});
