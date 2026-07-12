/** DI token for the active SessionStore binding. */
export const SESSION_STORE = Symbol('SessionStore');

/**
 * Hot sliding-activity state for Sessions. Postgres rows are the
 * durable truth (hash, binding, revocation, absolute expiry); this
 * store answers "was this Session used inside the sliding window"
 * without a timestamp scan, and its TTL is the window.
 */
export interface SessionStore {
  touch(sessionId: string, windowSeconds: number): Promise<void>;
  isActive(sessionId: string): Promise<boolean>;
  clear(sessionId: string): Promise<void>;
}
