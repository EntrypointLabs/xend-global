import { useEffect } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

import { router } from "expo-router";

import { apiClient } from "@/utils/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { getPushToken } from "@/utils/pushDevice";
import { AWAITING_PAYMENTS_KEY } from "@/hooks/useAwaitingPayments";
import { requestPendingChangeReview } from "@/hooks/usePendingChangeAcknowledgement";

/**
 * What a notice is about, and where tapping it lands. Mirrors the server's
 * NOTICE_KIND: every notice carries one, because a notification that opens the
 * app and leaves the Consumer to go and find the thing it was about has told
 * them something and then made the finding their problem.
 *
 * An unrecognised kind, and an older notice sent before any of this existed,
 * lands home rather than nowhere.
 */
const DESTINATIONS: Record<string, string> = {
  arrival: "/(tabs)/history",
  security_alert: "/(tabs)",
  pending_change: "/(tabs)",
  payment_approval: "/settings/finish-payment",
};

const PAYMENT_APPROVAL_KIND = "payment_approval";
const PENDING_CHANGE_KIND = "pending_change";
const HOME = "/(tabs)";

function noticeKind(
  notification: Notifications.Notification | undefined
): string | undefined {
  const data = notification?.request.content.data as
    | Record<string, unknown>
    | undefined;
  return typeof data?.kind === "string" ? data.kind : undefined;
}

/**
 * A notification that arrives while the Consumer is looking at the app is
 * handled by the in-app toast instead, so the OS banner is suppressed. Two
 * announcements of one payment is worse than either alone.
 *
 * A Payment waiting to be approved is the exception: nothing in the app
 * announces it as it arrives, the home banner and the Activity row only appear
 * on the next poll, and the person it is about is standing at a checkout. That
 * one gets the banner and a sound.
 */
Notifications.setNotificationHandler({
  handleNotification: (notification) => {
    const needsApproval = noticeKind(notification) === PAYMENT_APPROVAL_KIND;
    return Promise.resolve({
      shouldShowBanner: needsApproval,
      shouldShowList: true,
      shouldPlaySound: needsApproval,
      shouldSetBadge: false,
    });
  },
});

/**
 * Opens whatever a tapped notification was about.
 *
 * `useLastNotificationResponse` rather than a listener, because the tap that
 * matters most is the one that launched the app from cold: a listener
 * registered during that launch has already missed it.
 */
export function useNotificationRouting() {
  const response = Notifications.useLastNotificationResponse();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!response) return;
    const kind = noticeKind(response.notification);

    // The list the Payment screen renders was fetched before this Payment
    // existed.
    if (kind === PAYMENT_APPROVAL_KIND) {
      void queryClient.invalidateQueries({ queryKey: AWAITING_PAYMENTS_KEY });
    }

    // The review lives on the home screen and is what a staged change is
    // about. Asked for, so it opens even on the phone that staged the change
    // and even after the alarm was swiped away: someone who tapped the notice
    // wants to see the change, whichever phone they are holding.
    if (kind === PENDING_CHANGE_KIND) {
      void requestPendingChangeReview(queryClient);
    }

    router.push(((kind && DESTINATIONS[kind]) ?? HOME) as never);
  }, [response, queryClient]);
}

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

      const token = await getPushToken();
      if (!token || cancelled) return;

      await apiClient.registerPushDevice({
        token,
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
