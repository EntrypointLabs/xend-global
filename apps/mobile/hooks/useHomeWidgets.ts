import { useCallback, useEffect, useRef, useState } from "react";

import { useUserId } from "@/hooks/useUserId";
import { StorageService, userScopedKey } from "@/utils/storage";
import {
  DEFAULT_WIDGET_VISIBILITY,
  parseWidgetVisibility,
  type HomeWidgetKey,
  type HomeWidgetVisibility,
} from "@/utils/homeWidgets";

/** Which Home sections the Consumer has switched on, kept on this phone. */
export function useHomeWidgets() {
  const userId = useUserId();
  const storageKey = userScopedKey("home.widgets", userId ?? "signed-out");
  const [visibility, setVisibility] = useState<HomeWidgetVisibility>(
    DEFAULT_WIDGET_VISIBILITY
  );
  // A choice made before the saved one has loaded must win over it.
  const changedByUser = useRef(false);
  const latest = useRef(visibility);

  useEffect(() => {
    let cancelled = false;
    StorageService.getItem<unknown>(storageKey).then((stored) => {
      if (!cancelled && !changedByUser.current) {
        const loaded = parseWidgetVisibility(stored);
        latest.current = loaded;
        setVisibility(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const setVisible = useCallback(
    (key: HomeWidgetKey, visible: boolean) => {
      changedByUser.current = true;
      const next = { ...latest.current, [key]: visible };
      latest.current = next;
      setVisibility(next);
      StorageService.setItem(storageKey, next).catch(() => {});
    },
    [storageKey]
  );

  return { visibility, setVisible };
}
