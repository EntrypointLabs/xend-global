/**
 * Surfaces that render but cannot yet complete what they offer.
 *
 * The dApp Store rejected the app for features a reviewer could not verify, so
 * anything that looks operable and is not stays hidden by default. Hidden
 * rather than deleted: the screens and their flows are built and wanted, they
 * are simply ahead of the backend, and each flag is one environment variable
 * away from returning.
 *
 * Set the variable to "true" in `.env` to develop against one of these.
 */

/** Shielded receive. The toggle renders but nothing is behind it. */
export const HIDE_MY_WALLET_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_HIDE_MY_WALLET === "true";

/** Kamino deposits. The position reads correctly; there is no way to fund it. */
export const EARN_DEPOSITS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_EARN_DEPOSITS === "true";
