// Tiny module-level event bus that breaks the apiClient ↔ AuthContext cycle.
//
// `apiClient.request<T>()` can't import `AuthContext` directly (AuthContext
// imports apiClient for /auth/* and /passkeys/* calls — that's the cycle).
// When request<T>() hits a 401 it emits `unauthorized` here; AuthProvider
// subscribes on mount and routes to logout.
//
// Plain TypeScript, no React, no extra dep.

type Listener = () => void;

const listeners = new Set<Listener>();

export const AuthEvents = {
  /** Subscribe to unauthorized events. Returns an unsubscribe function. */
  onUnauthorized(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** Notify subscribers that the current session is no longer valid (e.g. 401). */
  emitUnauthorized(): void {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // A listener throwing must not block other listeners.
      }
    });
  },
};
