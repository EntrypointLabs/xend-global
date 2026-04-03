import { useState } from "react";
import { apiClient } from "@/utils/apiClient";
import { AuthStorage } from "@/utils/storage/authStorage";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import * as Sentry from "@sentry/react-native";

export function usePasskey() {
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const checkPasskeys = async (accountAddress: string): Promise<boolean> => {
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
      Sentry.captureException(
        new Error(`Passkey check failed: ${err}`)
      );
      setError("Failed to check passkey status.");
      setHasPasskey(false);
      setIsChecking(false);
      return false;
    }
  };

  const registerPasskey = async (
    accountAddress: string
  ): Promise<boolean> => {
    setIsRegistering(true);
    setError(null);
    try {
      // Get hosted URL from backend
      const response = await apiClient.createPasskeySession(accountAddress, {
        appName: "Fuse",
      });

      const url = response?.data?.url || response?.url;
      if (!url) {
        throw new Error("No passkey session URL returned");
      }

      // Open system browser for WebAuthn ceremony
      const redirectUrl = Linking.createURL("passkey-callback");
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl);

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
        setError(
          errorMsg || "Passkey registration failed. Please try again."
        );
        setIsRegistering(false);
        return false;
      }

      setError("Passkey registration failed. Please try again.");
      setIsRegistering(false);
      return false;
    } catch (err) {
      Sentry.captureException(
        new Error(`Passkey registration failed: ${err}`)
      );
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
