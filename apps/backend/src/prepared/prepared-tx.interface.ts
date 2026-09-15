export const PREPARED_TX_STORE = Symbol('PREPARED_TX_STORE');

/**
 * What a Consumer was last handed to sign, keyed by flow and user or intent.
 *
 * Every submit endpoint has the settlement authority co-sign whatever arrives,
 * so the only bytes it may ever sign are bytes this backend built. The pin
 * used to live in a Map on each service, which meant a second backend
 * instance, or a restart between prepare and submit, refused a perfectly good
 * signature. Shared here so any instance can complete what any other prepared.
 *
 * Values expire on their own: a blockhash is good for about a minute, so a
 * pin older than a few is unusable anyway.
 */
export interface PreparedTxStore {
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
}

/** Long enough for a biometric prompt and a slow network, short enough that a stale blockhash never outlives its pin by much. */
export const PREPARED_TX_TTL_SECONDS = 5 * 60;
