import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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
  const queryClient = useQueryClient();
  const storageKey = userScopedKey("home.widgets", userId ?? "signed-out");
  const queryKey = ["home-widgets", storageKey];

  const { data } = useQuery({
    queryKey,
    queryFn: async () =>
      parseWidgetVisibility(await StorageService.getItem(storageKey)),
    staleTime: Infinity,
  });
  const visibility: HomeWidgetVisibility = data ?? DEFAULT_WIDGET_VISIBILITY;

  const setVisible = useCallback(
    (key: HomeWidgetKey, visible: boolean) => {
      const next = { ...visibility, [key]: visible };
      queryClient.setQueryData(queryKey, next);
      StorageService.setItem(storageKey, next).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibility, storageKey, queryClient]
  );

  return { visibility, setVisible };
}
