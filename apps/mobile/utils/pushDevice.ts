import { apiClient } from "@/utils/apiClient";

/**
 * This installation's push address, or null when there is nothing to give.
 *
 * A simulator has no token, and neither does a device that has not granted
 * permission. Both are ordinary states rather than failures.
 *
 * The native modules are required lazily rather than imported. This module is
 * reached from the auth context, which every screen sits inside, and a build
 * whose native side does not carry `ExpoDevice` throws on the import alone: the
 * app died at startup rather than losing the one thing here that needs it.
 */
export async function getPushToken(): Promise<string | null> {
  // Every failure here is the same answer: this installation has no address to
  // be reached at. Reading `Device.isDevice` resolves the native module on
  // access, so even a successful require can throw a line later, and a build
  // without the module must degrade to "no token" rather than take the app
  // down with it.
  try {
    const native = loadNativeModules();
    if (!native) return null;

    const { Device, Notifications, Constants } = native;
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
  } catch (err) {
    if (__DEV__) console.warn("[push] no push token available", err);
    return null;
  }
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

interface PushNativeModules {
  Device: typeof import("expo-device");
  Notifications: typeof import("expo-notifications");
  Constants: typeof import("expo-constants").default;
}

function loadNativeModules(): PushNativeModules | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return {
      Device: require("expo-device") as typeof import("expo-device"),
      Notifications:
        require("expo-notifications") as typeof import("expo-notifications"),
      Constants: (
        require("expo-constants") as {
          default: typeof import("expo-constants").default;
        }
      ).default,
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    return null;
  }
}
