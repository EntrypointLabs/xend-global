import React, { createContext, useContext, useEffect, useState } from "react";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
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
import { isJwtExpired } from "@/utils/jwt";
import { useEnsureSolanaWallet } from "@/hooks/useEnsureSolanaWallet";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Privy-backed auth provider. Must render inside the `<PrivyProvider>` wrap
 * in `app/_layout.tsx`, since it consumes Privy hooks.
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
  const [needsTokenRefresh, setNeedsTokenRefresh] = useState(false);
  const [pendingPasskeySetup, setPendingPasskeySetup] = useState(false);

  const queryClient = useQueryClient();

  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { getIdentityToken } = useIdentityToken();
  const {
    logout: privyLogout,
    user: privyUser,
    isReady: privyReady,
  } = usePrivy();
  const embeddedSolana = useEmbeddedSolanaWallet();
  const ensureSolanaWalletReady = useEnsureSolanaWallet();

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const storedUser = await AuthStorage.getUser();
        setUser(storedUser);
        const savedEmail = await AuthStorage.getEmail();
        setEmail(savedEmail);

        const token = await AuthStorage.getToken();
        if (token && !isJwtExpired(token)) {
          setIsAuthenticated(true);
        } else if (await AuthStorage.isAuthenticated()) {
          // Session restored but the backend JWT is missing or expired. Defer
          // to the refresh effect, which silently re-exchanges the Privy
          // identity token once the SDK is ready (or drops to logged-out).
          // Leaving isAuthenticated null keeps the loading screen up instead
          // of flashing an authed UI whose API calls would 401.
          setNeedsTokenRefresh(true);
        } else {
          setIsAuthenticated(false);
        }
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

  // Silent re-auth: when a restored session has no valid backend JWT, wait for
  // Privy to be ready and exchange its identity token for a fresh JWT. If Privy
  // has no session (or the exchange fails), drop to logged-out rather than
  // stranding the user in an authed UI whose protected calls 401.
  useEffect(() => {
    if (!needsTokenRefresh || !privyReady) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        if (!privyUser) throw new Error("no Privy session to refresh from");
        const idToken = await getIdentityToken();
        if (!idToken) throw new Error("Privy returned no identity token");

        const exchange = await apiClient.exchange({ privyIdToken: idToken });
        if (cancelled) return;

        const refreshedUser = {
          id: exchange.user.id,
          email: exchange.user.email,
          walletAddress: exchange.user.walletAddress,
          smart_account_address: exchange.user.walletAddress,
        };
        await AuthStorage.saveToken(exchange.token);
        await AuthStorage.saveUserData(refreshedUser);
        await AuthStorage.saveEmail(exchange.user.email);
        await AuthStorage.saveIsAuthenticated(true);
        if (cancelled) return;

        setUser(refreshedUser);
        setEmail(exchange.user.email);
        setWallet(exchange.user.walletAddress);
        setIsAuthenticated(true);
      } catch (error) {
        Sentry.captureException(
          new Error(`Silent token refresh failed: ${error}. AuthContext`)
        );
        await AuthStorage.clearAuthData().catch(() => {});
        if (cancelled) return;
        setUser(null);
        setWallet(null);
        setIsAuthenticated(false);
      } finally {
        if (!cancelled) setNeedsTokenRefresh(false);
      }
    };

    refresh();
    return () => {
      cancelled = true;
    };
    // Trigger only on the refresh flags; getIdentityToken is captured by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsTokenRefresh, privyReady, privyUser]);

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
      // A stale Privy session blocks a fresh loginWithCode; clear it first.
      if (privyUser) {
        await privyLogout();
      }
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
      const loggedInUser = await loginWithCode({ code });
      if (!loggedInUser) {
        throw new Error("Privy loginWithCode returned no user");
      }

      // Wait for the embedded Solana wallet to finish provisioning before the
      // exchange, so the backend verifies an identity that already has a linked
      // wallet (a fresh user otherwise races the wallet creation -> 422).
      await ensureSolanaWalletReady();

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
        // KYC screens still read smart_account_address; mirror walletAddress
        // into it so they keep working.
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
    // Gate the redirect out of the auth stack until the passkey step resolves,
    // so the setup modal isn't unmounted by the tabs redirect.
    setPendingPasskeySetup(true);
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

      // Drop all cached queries so the next user's session doesn't read the
      // previous user's balances/activity from cache.
      queryClient.clear();

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

  const completePasskeySetup = () => setPendingPasskeySetup(false);

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
