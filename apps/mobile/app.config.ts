import type { ExpoConfig } from "expo/config";

import base from "./app.json";

/**
 * The Sentry slugs are deployment identity, not source. They were checked in
 * as placeholders, which uploads a production build's source maps to whatever
 * project happens to answer to them. Reading them from the environment means a
 * release either names the real project or fails before it ships.
 */
const SENTRY_PLUGIN = "@sentry/react-native/expo";

export default (): ExpoConfig => {
  const expo = base.expo as unknown as ExpoConfig;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  const releasing = process.env.EAS_BUILD_PROFILE === "production";

  if (releasing && (!org || !project)) {
    throw new Error(
      "SENTRY_ORG and SENTRY_PROJECT are required for a production build"
    );
  }

  const plugins = (expo.plugins ?? []).map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== SENTRY_PLUGIN) return plugin;
    const [name, options] = plugin as [string, Record<string, unknown>];
    return [
      name,
      {
        ...options,
        ...(org ? { organization: org } : {}),
        ...(project ? { project } : {}),
      },
    ] as [string, Record<string, unknown>];
  });

  return { ...expo, plugins };
};
