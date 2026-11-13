import { z } from "zod";

import { BUILD_FEATURES, type FeatureName } from "@/constants/Features";

/** What the server allows. A feature it does not mention is allowed. */
export const ServerFeaturesSchema = z
  .object({
    swap: z.boolean(),
    earnDeposits: z.boolean(),
    hideMyWallet: z.boolean(),
  })
  .partial();
export type ServerFeatures = z.infer<typeof ServerFeaturesSchema>;

export const FEATURES_STORE = "features:server";

export interface FeatureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * The server's answer, or the last one this device saw when the server cannot
 * be reached.
 *
 * Never throws. A switch the server turned off has to stay off through a
 * launch with no network, and a device that has never heard from the server
 * gets null, which leaves the build's own setting in force.
 */
export async function loadServerFeatures(
  fetchLive: () => Promise<ServerFeatures>,
  store: FeatureStore
): Promise<ServerFeatures | null> {
  let live: ServerFeatures;
  try {
    live = await fetchLive();
  } catch {
    return readStored(store);
  }
  await store.setItem(FEATURES_STORE, JSON.stringify(live)).catch(() => {});
  return live;
}

async function readStored(store: FeatureStore): Promise<ServerFeatures | null> {
  try {
    const raw = await store.getItem(FEATURES_STORE);
    if (!raw) return null;
    const parsed = ServerFeaturesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The build decides whether a feature can exist; the server can only take it away. */
export function isFeatureEnabled(
  name: FeatureName,
  server: ServerFeatures | null | undefined,
  build: Record<FeatureName, boolean> = BUILD_FEATURES
): boolean {
  return build[name] && server?.[name] !== false;
}
