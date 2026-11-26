import type { EarnProviderId } from '@prydd/smart-account';

export const EARN_HISTORY_RANGES = ['7d', '30d', '1y', 'all'] as const;
export type EarnHistoryRange = (typeof EARN_HISTORY_RANGES)[number];

/** One lent asset at one provider: the unit every Earn figure is kept in. */
export interface EarnPositionKey {
  provider: EarnProviderId;
  mint: string;
}

export function positionKey(key: EarnPositionKey): string {
  return `${key.provider}:${key.mint}`;
}

export interface EarnLedgerRow {
  provider: EarnProviderId;
  mint: string;
  status: string;
  cashDeltaRaw: string | null;
  shareDeltaRaw: string | null;
  confirmedAt: Date | null;
}

export interface ProviderEarnings {
  lifetimeMinor: string | null;
  lastSevenDaysMinor: string | null;
  /** Null when the ledger does not explain the shares held on chain. */
  netDepositedMinor: string | null;
}

export interface EarnSnapshot {
  provider: EarnProviderId;
  mint: string;
  valueMinor: string;
  netDepositedMinor: string;
}

export interface EarnSnapshotRow {
  day: string;
  valueMinor: string;
  netDepositedMinor: string;
}

/** The snapshots a seven-day figure is measured from, for one position. */
export interface EarnBaseline {
  /** Latest snapshot on or before the day seven days ago. */
  weekAgo: EarnSnapshotRow | null;
  earliest: EarnSnapshotRow | null;
}

export interface EarnHistoryPoint {
  day: string;
  valueMinor: string;
  earnedMinor: string;
}

const DAY_MS = 86_400_000;

/** Share-price rounding can leave a fresh position one unit below principal. */
export function clampEarned(earned: bigint): bigint {
  return earned < 0n ? 0n : earned;
}

export function earnedMinor(valueMinor: string, netDepositedMinor: string) {
  return clampEarned(BigInt(valueMinor) - BigInt(netDepositedMinor)).toString();
}

/** Every amount in and out is in the position's own asset base units. */
export function providerEarnings(
  rows: EarnLedgerRow[],
  key: EarnPositionKey,
  position: { shares: bigint; value: bigint },
  now: number,
  baseline: EarnBaseline = { weekAgo: null, earliest: null },
): ProviderEarnings {
  const confirmed = rows.filter(
    (r) =>
      r.provider === key.provider &&
      r.mint === key.mint &&
      r.status === 'confirmed',
  );
  const recorded = confirmed.reduce(
    (n, r) => n + BigInt(r.shareDeltaRaw ?? '0'),
    0n,
  );
  if (recorded !== position.shares)
    return {
      lifetimeMinor: null,
      lastSevenDaysMinor: null,
      netDepositedMinor: null,
    };
  // Cash leaves the vault on deposit, so the vault's deltas negate to principal.
  const netDeposited = -confirmed.reduce(
    (n, r) => n + BigInt(r.cashDeltaRaw ?? '0'),
    0n,
  );
  const lifetime = clampEarned(position.value - netDeposited);
  const since = (snapshot: EarnSnapshotRow) =>
    clampEarned(
      lifetime -
        BigInt(earnedMinor(snapshot.valueMinor, snapshot.netDepositedMinor)),
    ).toString();
  const recentOnly = confirmed.every(
    (r) => r.confirmedAt && r.confirmedAt.getTime() >= now - 7 * DAY_MS,
  );
  // History only began when snapshots did, so a position older than the
  // window with no week-old snapshot is measured from the earliest one: an
  // understatement, never lifetime income presented as seven-day income.
  const lastSevenDays = baseline.weekAgo
    ? since(baseline.weekAgo)
    : recentOnly
      ? lifetime.toString()
      : baseline.earliest
        ? since(baseline.earliest)
        : null;
  return {
    lifetimeMinor: lifetime.toString(),
    lastSevenDaysMinor: lastSevenDays,
    netDepositedMinor: netDeposited.toString(),
  };
}

/** Sums figures already in one unit; any unknown makes the total unknown. */
export function totalEarnings(
  figures: Iterable<
    Pick<ProviderEarnings, 'lifetimeMinor' | 'lastSevenDaysMinor'>
  >,
) {
  const all = [...figures];
  const sum = (key: 'lifetimeMinor' | 'lastSevenDaysMinor') => {
    let total = 0n;
    for (const p of all) {
      if (p[key] === null) return null;
      total += BigInt(p[key]);
    }
    return total.toString();
  };
  return {
    lifetimeMinor: sum('lifetimeMinor'),
    lastSevenDaysMinor: sum('lastSevenDaysMinor'),
  };
}

/**
 * A fully withdrawn position still records its zero day, so its chart ends
 * at zero instead of stopping at the last day it held anything.
 */
export function snapshotsToRecord(
  positions: (EarnPositionKey & {
    value: bigint;
    earnings: ProviderEarnings;
  })[],
  withHistory: ReadonlySet<string>,
): EarnSnapshot[] {
  return positions.flatMap((p) => {
    const net = p.earnings.netDepositedMinor;
    if (net === null) return [];
    if (p.value === 0n && !withHistory.has(positionKey(p))) return [];
    return [
      {
        provider: p.provider,
        mint: p.mint,
        valueMinor: p.value.toString(),
        netDepositedMinor: net,
      },
    ];
  });
}

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function weekAgoDay(now: number): string {
  return utcDay(new Date(now - 7 * DAY_MS));
}

/** The first day included in a range, counting today as one of its days. */
export function rangeStartDay(
  range: EarnHistoryRange,
  now: Date,
): string | null {
  const days = { '7d': 7, '30d': 30, '1y': 365, all: null }[range];
  if (days === null) return null;
  return utcDay(new Date(now.getTime() - (days - 1) * DAY_MS));
}

export function historyPoints(rows: EarnSnapshotRow[]): EarnHistoryPoint[] {
  return [...rows]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((r) => ({
      day: r.day,
      valueMinor: r.valueMinor,
      earnedMinor: earnedMinor(r.valueMinor, r.netDepositedMinor),
    }));
}
