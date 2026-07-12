/** DI token for the active RateCounter binding. */
export const RATE_COUNTER = Symbol('RateCounter');

export interface CounterSnapshot {
  count: number;
  /** Accumulated u64 amount as a decimal string; compare with BigInt. */
  totalRaw: string;
}

/**
 * Windowed counters for capacity and velocity checks. Keys embed the
 * window (for example cap:consumer:<id>:day:<yyyymmdd>) so windows
 * roll over by key change and expire via TTL, never by cron.
 */
export interface RateCounter {
  increment(
    key: string,
    amountRaw: string,
    ttlSeconds: number,
  ): Promise<CounterSnapshot>;
  peek(key: string): Promise<CounterSnapshot>;
  clear(key: string): Promise<void>;
}
