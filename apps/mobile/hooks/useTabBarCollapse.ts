import { useCallback, useRef, useSyncExternalStore } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/** Below this the bar stays open, so a nudge at the top never folds it. */
const OPEN_NEAR_TOP = 24;
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
 * Folds the tab bar to its current tab while the Consumer scrolls down, and
 * opens it again on the way back up, the way iOS does its own.
 */
export function useCollapseOnScroll() {
  const lastY = useRef(0);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const delta = y - lastY.current;
      if (y <= OPEN_NEAR_TOP) {
        setTabBarCollapsed(false);
        lastY.current = y;
      } else if (Math.abs(delta) >= DIRECTION_SLOP) {
        setTabBarCollapsed(delta > 0);
        lastY.current = y;
      }
    },
    []
  );
  return { onScroll, scrollEventThrottle: 16 } as const;
}
