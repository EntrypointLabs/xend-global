import { useCallback, useSyncExternalStore } from 'react';

export function quoteExpired(expiresAt: string) {
  const deadline = Date.parse(expiresAt);
  return !Number.isFinite(deadline) || Date.now() >= deadline;
}

/** UI-only guard. The server remains authoritative for quote validity. */
export function useQuoteExpired(expiresAt: string) {
  const snapshot = useCallback(() => quoteExpired(expiresAt), [expiresAt]);
  const subscribe = useCallback(
    (notify: () => void) => {
      let timer: ReturnType<typeof setTimeout>;
      const check = () => {
        clearTimeout(timer);
        notify();
        if (!quoteExpired(expiresAt)) {
          timer = setTimeout(
            check,
            Math.min(Date.parse(expiresAt) - Date.now(), 2147483647),
          );
        }
      };
      check();
      window.addEventListener('focus', check);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('focus', check);
      };
    },
    [expiresAt],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
