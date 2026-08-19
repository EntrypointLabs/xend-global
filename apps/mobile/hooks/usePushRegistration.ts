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
    enabled: query.data ?? true,
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
    if (!isAuthenticated || !enabled) return;
    let cancelled = false;

    void (async () => {
      if (!Device.isDevice) return;

      const existing = await Notifications.getPermissionsAsync();
      const granted =
        existing.granted ||
        (await Notifications.requestPermissionsAsync()).granted;
      if (!granted || cancelled) return;

      // Android needs a channel before anything can be delivered to it.
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

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
    })().catch(() => {
      // Registration is best-effort. A Consumer who cannot be reached by push
      // still has the app, the toast and the activity feed.
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, enabled]);
}
