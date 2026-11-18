import { useCallback, useRef, useSyncExternalStore } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/** Scrolling this close to the top never folds the bar. */
const FOLD_AFTER = 24;
/** Movement smaller than this is jitter, not a direction. */
const DIRECTION_SLOP = 6;

let collapsed = false;
const listeners = new Set<() => void>();

export function setTabBarCollapsed(next: boolean) {
  if (next === collapsed) return;
  collapsed = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTabBarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, () => collapsed);
}

/**
 * Folds the tab bar to its current tab once the Consumer scrolls down. Only a
 * tap opens it again, so reading back up never springs it open.
 */
export function useCollapseOnScroll() {
  const lastY = useRef(0);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const delta = y - lastY.current;
      if (Math.abs(delta) < DIRECTION_SLOP) return;
      if (delta > 0 && y > FOLD_AFTER) setTabBarCollapsed(true);
      lastY.current = y;
    },
    []
  );
  return { onScroll, scrollEventThrottle: 16 } as const;
}
