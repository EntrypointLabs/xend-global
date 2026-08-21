import { useEffect } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

import { apiClient } from "@/utils/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";

/**
 * A notification that arrives while the Consumer is looking at the app is
 * handled by the in-app toast instead, so the OS banner is suppressed. Two
 * announcements of one payment is worse than either alone.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** The Consumer's own answer about notifications, as the server holds it. */
export function useNotificationPreference() {
  const { isAuthenticated } = useAuth();
  const userId = useUserId();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["notifications", "preference", userId],
    queryFn: () => apiClient.getNotificationPreference(),
    enabled: Boolean(isAuthenticated),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      apiClient.setNotificationPreference(enabled),
    onSuccess: (enabled) => {
      queryClient.setQueryData(
        ["notifications", "preference", userId],
        enabled
      );
    },
  });

  return {
    // Undefined until the server answers. Callers must not read a default here:
    // treating "unknown" as "on" registers a token for someone who already
    // opted out, quietly opting them back in.
    enabled: query.data,
    isLoading: query.isLoading,
    setEnabled: mutation.mutate,
  };
}

/**
 * Tells the server where to reach this installation.
 *
 * Runs once the Consumer is signed in and has said they want notifications.
 * The OS prompt is only asked for at that point: permission requested before
 * anyone has expressed interest is the prompt people deny out of hand, and iOS
 * gives you exactly one chance to ask.
 *
 * A simulator has no push token to give, so it is skipped rather than treated
 * as a failure.
 */
export function usePushRegistration() {
  const { isAuthenticated } = useAuth();
  const { enabled } = useNotificationPreference();

  useEffect(() => {
    // `enabled` is undefined until the stored preference arrives. Registering
    // on the optimistic default would opt an opted-out Consumer back in on any
    // fresh install.
    if (!isAuthenticated || enabled !== true) return;
    let cancelled = false;

    void (async () => {
      if (!Device.isDevice) return;

      // The channel has to exist before the permission prompt on Android 13+,
      // or the prompt may never appear and no token is ever issued.
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const existing = await Notifications.getPermissionsAsync();
      const granted =
        existing.granted ||
        (await Notifications.requestPermissionsAsync()).granted;
      if (!granted || cancelled) return;

      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;
      const token = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      if (cancelled) return;

      await apiClient.registerPushDevice({
        token: token.data,
        platform: Platform.OS === "ios" ? "ios" : "android",
      });
    })().catch((err: unknown) => {
      // Registration is best-effort: a Consumer who cannot be reached by push
      // still has the app, the toast and the activity feed. But swallowing the
      // reason leaves "notifications just don't work" with nothing to go on,
      // so development says what happened.
      if (__DEV__) console.warn("[push] registration failed", err);
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, enabled]);
}
