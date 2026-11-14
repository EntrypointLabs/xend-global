import type { ActivityEntry } from "@/utils/activity";

export interface MonthlySpend {
  totalUsd: number;
  /** Running total at the end of each day so far, starting from zero. */
  cumulative: number[];
}

/**
 * What left the Account this calendar month, in USD.
 *
 * Counts sends and merchant Payments at the value frozen when they happened,
 * and skips failed ones and anything the backend could not price. Receives are
 * not spending, and security events and unfinished Payments moved nothing.
 */
export function summariseMonthlySpend(
  entries: ActivityEntry[],
  now: Date = new Date()
): MonthlySpend {
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const perDay = new Array<number>(today).fill(0);

  for (const entry of entries) {
    if (entry.kind !== "transfer" && entry.kind !== "payment") continue;
    if (entry.direction !== "send" || entry.status === "failed") continue;
    const usd = entry.usdValue == null ? NaN : Number(entry.usdValue);
    if (!Number.isFinite(usd)) continue;
    const at = new Date(entry.createdAt);
    if (at.getFullYear() !== year || at.getMonth() !== month) continue;
    const day = at.getDate();
    if (day > today) continue;
    perDay[day - 1] += usd;
  }

  let running = 0;
  const cumulative = [0];
  for (const spent of perDay) {
    running += spent;
    cumulative.push(running);
  }
  return { totalUsd: running, cumulative };
}

export interface MonthlyFlow {
  inUsd: number;
  outUsd: number;
}

/**
 * Money in and money out this calendar month, in USD, by the same rules as
 * {@link summariseMonthlySpend}: frozen values only, failed and unpriced rows
 * skipped, and nothing for events that moved no money.
 */
export function summariseMonthlyFlow(
  entries: ActivityEntry[],
  now: Date = new Date()
): MonthlyFlow {
  const year = now.getFullYear();
  const month = now.getMonth();
  let inUsd = 0;
  let outUsd = 0;

  for (const entry of entries) {
    if (entry.kind !== "transfer" && entry.kind !== "payment") continue;
    if (entry.status === "failed") continue;
    const usd = entry.usdValue == null ? NaN : Number(entry.usdValue);
    if (!Number.isFinite(usd)) continue;
    const at = new Date(entry.createdAt);
    if (at.getFullYear() !== year || at.getMonth() !== month) continue;
    if (at > now) continue;
    if (entry.direction === "send") outUsd += usd;
    else inUsd += usd;
  }
  return { inUsd, outUsd };
}
