/**
 * Features that can be switched off: surfaces that render but cannot yet
 * finish what they offer, or that lean on an outside provider that can fail.
 *
 * Everything is on by default, and there are two ways to turn a feature off:
 *
 * - In the build, by setting its `EXPO_PUBLIC_ENABLE_*` variable to "false".
 *   The feature is compiled out and nothing the server says brings it back.
 * - At runtime, by setting its kill switch on the backend, which `GET
 *   /features` reports. The app picks that up on its next launch or return to
 *   the foreground, with no new build.
 *
 * Read them through `useFeature`, which applies both.
 */
export type FeatureName = "swap" | "earnDeposits" | "hideMyWallet";

const onUnlessFalse = (value: string | undefined) => value !== "false";

export const BUILD_FEATURES: Record<FeatureName, boolean> = {
  /**
   * Swap. It signs from the embedded wallet, but the Balance sits in the
   * Account's vault, so it cannot reach the Consumer's money until it runs as
   * a Spend.
   */
  swap: onUnlessFalse(process.env.EXPO_PUBLIC_ENABLE_SWAP),
  /** Kamino deposits. The position reads correctly; there is no way to fund it. */
  earnDeposits: onUnlessFalse(process.env.EXPO_PUBLIC_ENABLE_EARN_DEPOSITS),
  /** Shielded receive. The toggle renders but nothing is behind it. */
  hideMyWallet: onUnlessFalse(process.env.EXPO_PUBLIC_ENABLE_HIDE_MY_WALLET),
};
