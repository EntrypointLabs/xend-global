import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

import { apiClient } from "@/utils/apiClient";

/**
 * This installation's push address, or null when there is nothing to give.
 *
 * A simulator has no token, and neither does a device that has not granted
 * permission. Both are ordinary states rather than failures.
 */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  return token.data;
}

/**
 * Drops this installation's registration, on sign-out.
 *
 * Has to run while the session is still valid, and is best-effort: a Consumer
 * signing out must not be held up by it. The cost of skipping is that arrivals
 * for the person who signed out keep lighting up the phone, so the failure is
 * worth seeing in development.
 */
export async function forgetThisDevice(): Promise<void> {
  try {
    const token = await getPushToken();
    if (!token) return;
    await apiClient.forgetPushDevice(token);
  } catch (err) {
    if (__DEV__) console.warn("[push] could not forget this device", err);
  }
}
