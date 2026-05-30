import { useState } from "react";
import { apiClient } from "@/utils/apiClient";
import { AuthStorage } from "@/utils/storage/authStorage";
import { useNewStack } from "@/utils/featureFlags";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import * as Sentry from "@sentry/react-native";

export function usePasskey() {
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Under the new stack, Privy enrols the passkey IN-APP during signup
  // (`useLoginWithEmail` → `loginWithCode` → embedded wallet provisioned with
  // passkey-backed recovery). The legacy `/passkeys/check` and
  // `/passkeys/session` routes are Grid-shaped and do not exist on the new
  // NestJS backend, so calling them would 404. Both methods therefore become
  // no-op success paths under the flag: callers (the post-OTP check in
  // `(auth)/email-login.tsx` and the settings screen) see "already has a
  // passkey, nothing to do" and skip their setup UX.
  //
  // The legacy Grid path (flag off) is unchanged.
  const newStack = useNewStack();

  const clearError = () => setError(null);

  const checkPasskeys = async (accountAddress: string): Promise<boolean> => {
    if (newStack) {
      setHasPasskey(true);
      return true;
    }

    setIsChecking(true);
    setError(null);
    try {
      // Check cached value first
      const cached = await AuthStorage.getHasPasskey();
      if (cached) {
        setHasPasskey(true);
        setIsChecking(false);
        return true;
      }

      // Call backend → Grid SDK
      const response = await apiClient.checkPasskeys(accountAddress);
      const exists = response?.data?.passkey != null;

      if (exists) {
        await AuthStorage.saveHasPasskey(true);
      }

      setHasPasskey(exists);
      setIsChecking(false);
      return exists;
    } catch (err) {
      Sentry.captureException(new Error(`Passkey check failed: ${err}`));
      setError("Failed to check passkey status.");
      setHasPasskey(false);
      setIsChecking(false);
      return false;
    }
  };

  const registerPasskey = async (accountAddress: string): Promise<boolean> => {
    if (newStack) {
      setHasPasskey(true);
      return true;
    }

    setIsRegistering(true);
    setError(null);
    try {
      // Generate redirect URL first so Grid knows where to send user back
      const redirectUrl = Linking.createURL("passkey-callback");
      // Get hosted URL from backend
      const response = await apiClient.createPasskeySession(accountAddress, {
        appName: "Xend",
        redirectUrl,
      });

      const url = response?.data?.url;
      if (!url) {
        throw new Error("No passkey session URL returned");
      }

      // Open system browser for WebAuthn ceremony
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl);

      console.log("result", result);

      if (result.type === "cancel" || result.type === "dismiss") {
        setError("Passkey setup was cancelled. Please try again to continue.");
        setIsRegistering(false);
        return false;
      }

      if (result.type === "success") {
        // Parse the returned URL for status
        const returnedUrl = result.url;
        const params = new URL(returnedUrl).searchParams;
        const status = params.get("status");

        if (status === "success" || returnedUrl.includes("success")) {
          await AuthStorage.saveHasPasskey(true);
          setHasPasskey(true);
          setIsRegistering(false);
          return true;
        }

        // Check for error in params
        const errorMsg = params.get("error");
        setError(errorMsg || "Passkey registration failed. Please try again.");
        setIsRegistering(false);
        return false;
      }

      setError("Passkey registration failed. Please try again.");
      setIsRegistering(false);
      return false;
    } catch (err) {
      Sentry.captureException(new Error(`Passkey registration failed: ${err}`));
      setError(
        err instanceof Error
          ? err.message
          : "Passkey registration failed. Please try again."
      );
      setIsRegistering(false);
      return false;
    }
  };

  return {
    hasPasskey,
    isChecking,
    isRegistering,
    error,
    checkPasskeys,
    registerPasskey,
    clearError,
  };
}
