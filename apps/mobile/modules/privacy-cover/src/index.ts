import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

interface PrivacyCoverNative {
  configure(enabled: boolean, lockAfterMs: number): void;
  beginPrompt(): void;
  endPrompt(): void;
  reveal(): void;
}

// Optional so a binary built before the module existed falls back to the JS
// cover instead of failing to start.
const native =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<PrivacyCoverNative>("PrivacyCover")
    : null;

/**
 * The iOS blur that covers the app when the Consumer leaves it, drawn natively
 * so it appears and clears with no delay. Absent on Android and on older
 * binaries, where `available` is false and every call does nothing.
 */
export const privacyCover = {
  available: native !== null,
  configure(enabled: boolean, lockAfterMs: number) {
    native?.configure(enabled, lockAfterMs);
  },
  beginPrompt() {
    native?.beginPrompt();
  },
  endPrompt() {
    native?.endPrompt();
  },
  reveal() {
    native?.reveal();
  },
};
