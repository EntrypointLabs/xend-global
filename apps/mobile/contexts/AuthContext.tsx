import React, { createContext, useContext, useEffect, useState } from "react";
import { router } from "expo-router";
import * as Sentry from "@sentry/react-native";
import {
  useEmbeddedSolanaWallet,
  useIdentityToken,
  useLoginWithEmail,
  usePrivy,
} from "@privy-io/expo";

import { AccountInfo, AuthContextType } from "@/types/Auth";
import { AuthStorage } from "@/utils/storage/authStorage";
import { apiClient } from "@/utils/apiClient";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider — Privy-backed.
 *
 * Phase 5: the legacy Grid `LegacyAuthProvider` was deleted and the
 * feature flag is gone. Privy is the only auth path. Privy hooks are
 * children of the `<PrivyProvider>` wrap in `app/_layout.tsx`.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { getIdentityToken } = useIdentityToken();
  const { logout: privyLogout } = usePrivy();
  const embeddedSolana = useEmbeddedSolanaWallet();

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const storedUser = await AuthStorage.getUser();
        setUser(storedUser);
        const savedEmail = await AuthStorage.getEmail();
        setEmail(savedEmail);
        const authed = await AuthStorage.isAuthenticated();
        setIsAuthenticated(authed);
      } catch (error) {
        console.error("Error initializing auth:", error);
        Sentry.captureException(
          new Error(
            `Error initializing auth (Privy): ${error}. (contexts)/AuthContext.tsx`
          )
        );
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  /**
   * Step 1 of email login (and registration — Privy collapses the two).
   * Records the email and triggers Privy to send the OTP. The screen calls
   * `verifyCode(code)` next.
   */
  const authenticate = async (emailArg: string): Promise<void> => {
    setEmail(emailArg);
    setAuthError(null);
    await AuthStorage.saveEmail(emailArg);
    try {
      await sendCode({ email: emailArg });
    } catch (error) {
      Sentry.captureException(
        new Error(`Privy sendCode failed: ${error}. authenticate()`)
      );
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      setAuthError(errorMessage);
      throw error;
    }
  };

  // Privy collapses register into the same OTP flow as login.
  const register = authenticate;

  /**
   * Shared OTP-verify path for both login and register: Privy validates the
   * code, returns the user object; we then ask Privy for the ID token, send
   * it to our backend `/auth/exchange`, persist the returned JWT + user, and
   * mark the session authenticated.
   */
  const completeOtpAndExchange = async (code: string): Promise<boolean> => {
    try {
      const privyUser = await loginWithCode({ code });
      if (!privyUser) {
        throw new Error("Privy loginWithCode returned no user");
      }

      const idToken = await getIdentityToken();
      if (!idToken) {
        throw new Error(
          "Privy did not return an identity token after loginWithCode"
        );
      }

      const exchange = await apiClient.exchange({ privyIdToken: idToken });

      await AuthStorage.saveToken(exchange.token);
      await AuthStorage.saveUserData({
        id: exchange.user.id,
        email: exchange.user.email,
        walletAddress: exchange.user.walletAddress,
        // Keep the legacy field name alive for KYC screens that still read it
        // (useKyc.ts uses user.grid_user_id and user.address). The KYC swarm
        // replaces this when it migrates KYC to Sumsub.
        smart_account_address: exchange.user.walletAddress,
      });
      await AuthStorage.saveEmail(exchange.user.email);
      await AuthStorage.saveIsAuthenticated(true);

      setUser({
        id: exchange.user.id,
        email: exchange.user.email,
        walletAddress: exchange.user.walletAddress,
        smart_account_address: exchange.user.walletAddress,
      });
      setEmail(exchange.user.email);
      setWallet(exchange.user.walletAddress);
      setIsAuthenticated(true);
      setAuthError(null);
      return true;
    } catch (error) {
      Sentry.captureException(
        new Error(
          `Privy verifyCode + exchange failed: ${error}. (contexts)/AuthContext.tsx`
        )
      );
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      setAuthError(errorMessage);
      return false;
    }
  };

  const verifyCode = completeOtpAndExchange;
  const verifyCodeAndCreateAccount = completeOtpAndExchange;

  /**
   * Mirror of the legacy `completeLogin` — kept for `email-login.tsx`, which
   * uses `useLoginMutation` (not `verifyCode` above) and then calls
   * `completeLogin(...)` itself. State-sync shim only.
   */
  const completeLogin = async (
    userData: any,
    emailArg: string,
    token: string
  ): Promise<void> => {
    setUser(userData);
    setEmail(emailArg);
    setWallet(
      userData?.walletAddress ?? userData?.smart_account_address ?? null
    );
    await AuthStorage.saveUserData(userData);
    await AuthStorage.saveEmail(emailArg);
    if (token) {
      await AuthStorage.saveToken(token);
    }
    await AuthStorage.saveIsAuthenticated(true);
    setIsAuthenticated(true);
    setAuthError(null);
  };

  const logout = async () => {
    setIsLoggingOut(true);
    try {
      try {
        await privyLogout();
      } catch (privyErr) {
        Sentry.captureException(
          new Error(`Privy logout best-effort failure: ${privyErr}`)
        );
      }

      await AuthStorage.clearAuthData();

      setIsAuthenticated(false);
      setUser(null);
      setEmail(null);
      setAccountInfo(null);
      setWallet(null);

      router.replace("/(auth)/login");
    } catch (error) {
      Sentry.captureException(new Error(`Failed to logout (Privy): ${error}.`));
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      setAuthError(errorMessage);
      throw error;
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Privy enrols the passkey in-app during signup. No separate pending step.
  const pendingPasskeySetup = false;
  const completePasskeySetup = () => {};

  // Derive the wallet address surfaced to consumers from the union of
  // Privy's embedded wallet and the local React state (set on completeLogin
  // / verifyCode after the backend exchange returns). Render-time derivation
  // avoids the banned `setState` inside a `useEffect`.
  const embeddedAddress = embeddedSolana.wallets?.[0]?.address ?? null;
  const effectiveWallet = wallet ?? embeddedAddress;

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        email,
        setEmail,
        accountInfo,
        setAccountInfo,
        keypair: null,
        credentialsBundle: null,
        authError,
        authenticate,
        completeLogin,
        register,
        verifyCode,
        verifyCodeAndCreateAccount,
        logout,
        wallet: effectiveWallet,
        isLoading,
        isLoggingOut,
        pendingPasskeySetup,
        completePasskeySetup,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
