import { onlineManager } from "@tanstack/react-query";

/**
 * Runs a hardware-key signature with the app's other Keystore traffic held off.
 *
 * Signing with an auth-per-use key is two steps with a person in the middle:
 * `initSign` opens an Android Keystore operation, the Consumer is asked for a
 * fingerprint, and only then is the operation finished. Keystore allows a bounded
 * number of concurrent operations per app and prunes the least recently used to
 * make room, so anything else the app does with Keystore in that window can
 * evict the one waiting on the prompt. It comes back as
 * `INVALID_OPERATION_HANDLE` at finish, which the module reports as the
 * uninformative "signing failed".
 *
 * The app is a steady source of exactly that traffic: every authenticated
 * request reads the session token out of `expo-secure-store`, which is Keystore
 * backed, and the balance, account and pending-change queries keep polling
 * while the prompt is up. The longer someone takes to reach the sensor, the
 * more likely their signature is already lost.
 *
 * So fetching stops for the length of the prompt. Marking the client offline is
 * how TanStack Query is asked to hold, and it resumes on its own afterwards.
 * Nested and concurrent signatures share one pause, and it is released in a
 * `finally` so a refused fingerprint cannot leave the app wedged offline.
 */
let held = 0;
let wasOnline = true;

export async function withKeystoreQuiet<T>(run: () => Promise<T>): Promise<T> {
  if (held === 0) {
    wasOnline = onlineManager.isOnline();
    onlineManager.setOnline(false);
  }
  held += 1;
  try {
    return await run();
  } finally {
    held -= 1;
    if (held === 0) onlineManager.setOnline(wasOnline);
  }
}
