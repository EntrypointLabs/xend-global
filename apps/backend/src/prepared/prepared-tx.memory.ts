import type { PreparedTxStore } from './prepared-tx.interface';

/** Process-local store for tests and single-instance development. */
export class InMemoryPreparedTxStore implements PreparedTxStore {
  private readonly entries = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();

  constructor(private readonly now: () => number = () => Date.now()) {}

  set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.set(key, {
      value,
      expiresAt: this.now() + ttlSeconds * 1000,
    });
    return Promise.resolve();
  }

  get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value as T);
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}
