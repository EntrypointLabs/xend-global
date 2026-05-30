import * as SecureStore from "expo-secure-store";
import * as Sentry from "@sentry/react-native";

import { AUTH_STORAGE_KEYS } from "@/utils/auth";

/**
 * Legacy SecureStore key from the Grid-era `MockDatabase` shim. Not part of
 * `AUTH_STORAGE_KEYS`. Wiped alongside the auth keys on first launch under
 * the new stack so a fresh signup is forced.
 */
const LEGACY_MOCK_DATABASE_KEY = "mock_database";

/**
 * Phase-4 first-launch wipe.
 *
 * Idempotent. Reads `AUTH_STORAGE_KEYS.MIGRATION_DONE`; if already set to
 * `"true"`, returns immediately. Otherwise:
 *
 *   1. Deletes every value in `AUTH_STORAGE_KEYS` (the full set, not just the
 *      Grid-specific ones, so the user is taken back to the unauth start
 *      screen).
 *   2. Deletes the legacy `mock_database` SecureStore blob the old
 *      `MockDatabase` shim wrote.
 *   3. Sets `MIGRATION_DONE = "true"` so this never runs again on this
 *      install.
 *
 * Gated by `EXPO_PUBLIC_USE_NEW_STACK === 'true'` (the same env-var
 * `useNewStack()` in `utils/featureFlags.ts` reads — read directly here
 * to keep this module hook-free and importable from non-React contexts).
 * Callers are expected to `await` this from app start (before AuthProvider
 * initialises, so AuthStorage reads see the wiped state).
 *
 * Errors per-key are swallowed and reported to Sentry; one bad key must not
 * abort the rest of the wipe.
 */
export async function runFirstLaunchWipeIfNeeded(): Promise<void> {
  if (process.env.EXPO_PUBLIC_USE_NEW_STACK !== "true") {
    return;
  }

  try {
    const done = await SecureStore.getItemAsync(
      AUTH_STORAGE_KEYS.MIGRATION_DONE
    );
    if (done === "true") {
      return;
    }

    const keys = [
      ...Object.values(AUTH_STORAGE_KEYS).filter(
        (k) => k !== AUTH_STORAGE_KEYS.MIGRATION_DONE
      ),
      LEGACY_MOCK_DATABASE_KEY,
    ];

    await Promise.all(
      keys.map((key) =>
        SecureStore.deleteItemAsync(key).catch((err) => {
          Sentry.captureException(
            new Error(
              `runFirstLaunchWipeIfNeeded: failed to delete SecureStore key "${key}": ${err}`
            )
          );
        })
      )
    );

    await SecureStore.setItemAsync(AUTH_STORAGE_KEYS.MIGRATION_DONE, "true");
  } catch (err) {
    // Top-level failure (e.g. SecureStore unavailable). Log but do not throw —
    // the app must still boot. Worst case the wipe retries next launch.
    Sentry.captureException(
      new Error(`runFirstLaunchWipeIfNeeded: top-level failure: ${err}`)
    );
  }
}
