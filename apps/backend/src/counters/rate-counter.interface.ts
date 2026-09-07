/** DI token for the active RateCounter binding. */
export const RATE_COUNTER = Symbol('RateCounter');

/** DI token for the counter the capacity engine reserves against. */
export const CAPACITY_COUNTER = Symbol('CapacityCounter');

export interface CounterSnapshot {
  count: number;
  /** Accumulated u64 amount as a decimal string; compare with BigInt. */
  totalRaw: string;
}

export interface ReservationResult {
  allowed: boolean;
  /** The window after this call: unchanged when the reservation was refused. */
  snapshot: CounterSnapshot;
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

/**
 * A RateCounter whose reservation is atomic: the amount is added and
 * compared against the cap in one step, and rolled back inside that same
 * step when it overshoots, so two concurrent callers cannot both read
 * headroom and both spend it.
 */
export interface ReservingRateCounter extends RateCounter {
  reserve(
    key: string,
    amountRaw: string,
    capRaw: string,
    ttlSeconds: number,
  ): Promise<ReservationResult>;
  /** Gives back a reservation whose authorization did not go through. */
  release(key: string, amountRaw: string): Promise<void>;
}
