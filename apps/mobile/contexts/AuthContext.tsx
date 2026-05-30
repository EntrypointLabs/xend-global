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
import {
  registerUser,
  verifyOtpCodeAndCreateAccount,
  verifyOtpCode,
} from "@/utils/auth";
import { AuthStorage } from "@/utils/storage/authStorage";
import { useNewStack } from "@/utils/featureFlags";
import { apiClient } from "@/utils/apiClient";
import { SDKGridClient } from "../grid/sdkClient";
import { MockDatabase } from "@/utils/mockDatabase";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Top-level dispatcher.
 *
 * `useNewStack()` is a synchronous env-var read; the choice between Privy and
 * Grid is static for the app session. The two providers below are mounted
 * exclusively — never both — so Privy hooks inside `PrivyAuthProvider` are
 * always children of the `<PrivyProvider>` wrap in `app/_layout.tsx`, and the
 * legacy provider never depends on Privy being mounted.
 *
 * The shared `AuthContextType` shape means consumers (`login.tsx`,
 * `restore-account.tsx`, `email-login.tsx`) need no branching: they read
 * `useAuth()` and call the same methods regardless of stack.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (useNewStack()) {
    return <PrivyAuthProvider>{children}</PrivyAuthProvider>;
  }
  return <LegacyAuthProvider>{children}</LegacyAuthProvider>;
}

// ---------------------------------------------------------------------------
// Legacy (Grid) provider — unchanged behaviour from pre-Phase-4. Kept alive
// until Phase 5 deletes the old code paths entirely.
// ---------------------------------------------------------------------------

function LegacyAuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [keypair, setKeypair] = useState<AuthContextType["keypair"]>(null);
  const [credentialsBundle, setCredentialsBundle] = useState<string | null>(
    null
  );
  const [authError, setAuthError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [mpcPrimaryId, setMpcPrimaryId] = useState<string | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [pendingPasskeySetup, setPendingPasskeySetup] = useState(false);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const user = await AuthStorage.getUser();
        setUser(user);
        const savedEmail = await AuthStorage.getEmail();
        setEmail(savedEmail);
        const isAuthenticated = await AuthStorage.isAuthenticated();
        setIsAuthenticated(isAuthenticated);

        // If authenticated but no passkey cached, gate the redirect
        if (isAuthenticated) {
          const hasPasskey = await AuthStorage.getHasPasskey();
          if (!hasPasskey) {
            setPendingPasskeySetup(true);
          }
        }
      } catch (error) {
        console.error("Error initializing auth:", error);
        Sentry.captureException(
          new Error(
            `Error initializing auth: ${error}. (contexts)/AuthContext.tsx (initializeAuth)`
          )
        );
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, [user]);

  const verifyCodeAndCreateAccount = async (code: string): Promise<boolean> => {
    try {
      const gridClient = SDKGridClient.getFrontendClient();
      const sessionSecrets = await gridClient.generateSessionSecrets();

      await AuthStorage.saveSessionSecrets(sessionSecrets);
      const user = await AuthStorage.getUser();

      const result = await verifyOtpCodeAndCreateAccount(
        code,
        sessionSecrets,
        user
      );
      setUser(result.data);

      // Create user in MockDatabase with email
      if (result.data.grid_user_id && email) {
        await MockDatabase.createUser(result.data.grid_user_id, email);
      }

      setIsAuthenticated(true);
      await AuthStorage.saveIsAuthenticated(true);
      setAuthError(null);
      await AuthStorage.saveUserData(result.data);

      return true;
    } catch (error) {
      Sentry.captureException(
        new Error(
          `Error verifying code: ${error}. (contexts)/AuthContext.tsx (verifyCode)`
        )
      );
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      setAuthError(errorMessage);
      return false;
    }
  };

  const verifyCode = async (code: string): Promise<boolean> => {
    try {
      const gridClient = SDKGridClient.getFrontendClient();
      const sessionSecrets = await gridClient.generateSessionSecrets();

      await AuthStorage.saveSessionSecrets(sessionSecrets);

      const userData = await AuthStorage.getUser();

      if (!userData) {
        throw new Error("User not found");
      }

      const result = await verifyOtpCode(code, sessionSecrets, userData);
      setUser(result.data);

      // Create user in MockDatabase with email
      if (result.data.grid_user_id && email) {
        await MockDatabase.createUser(result.data.grid_user_id, email);
      }

      setIsAuthenticated(true);
      await AuthStorage.saveIsAuthenticated(true);
      setAuthError(null);
      await AuthStorage.saveUserData(result.data);

      return true;
    } catch (error) {
      Sentry.captureException(
        new Error(
          `Error verifying code: ${error}. (contexts)/AuthContext.tsx (verifyCode)`
        )
      );
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      setAuthError(errorMessage);
      return false;
    }
  };

  const logout = async () => {
    setIsLoggingOut(true);
    try {
      await AuthStorage.clearAuthData();

      setIsAuthenticated(false);
      setPendingPasskeySetup(false);
      setUser(null);
      setEmail(null);
      setAccountInfo(null);
      setCredentialsBundle(null);
      setKeypair(null);
      setWallet(null);
      setMpcPrimaryId(null);

      router.replace("/(auth)/login");
    } catch (error) {
      Sentry.captureException(
        new Error(
          `Failed to logout: ${error}. (contexts)/AuthContext.tsx (logout)`
        )
      );
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      setAuthError(errorMessage);
      throw error;
    } finally {
      setIsLoggingOut(false);
    }
  };

  const completeLogin = async (
    userData: any,
    email: string,
    token: string
  ): Promise<void> => {
    setUser(userData);
    setEmail(email);
    await AuthStorage.saveUserData(userData);
    await AuthStorage.saveEmail(email);
    await AuthStorage.saveToken(token);
    await AuthStorage.saveIsAuthenticated(true);
    setIsAuthenticated(true);
    setPendingPasskeySetup(true);
    setAuthError(null);
  };

  const completePasskeySetup = () => {
    setPendingPasskeySetup(false);
  };

  const authenticate = async (email: string): Promise<void> => {
    setUser({
      address: "HskwRmauuraCF6mMBMn8CfiPvAXGSL8t5QDBzERKcoaS",
    });
    setEmail(email);
    await AuthStorage.saveUserData({});
    await AuthStorage.saveEmail(email);
    await AuthStorage.saveIsAuthenticated(true);

    setIsAuthenticated(true);
    setAuthError(null);
  };

  const register = async (email: string): Promise<void> => {
    try {
      const result = await registerUser(email);

      setUser(result.data);
      setEmail(email);

      await AuthStorage.saveUserData(result.data);
      await AuthStorage.saveEmail(email);

      setMpcPrimaryId(mpcPrimaryId);
      setAuthError(null);
    } catch (error) {
      Sentry.captureException(
        new Error(
          `Error authenticating: ${error}. (contexts)/AuthContext.tsx (authenticate)`
        )
      );
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      setAuthError(errorMessage);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        email,
        setEmail,
        accountInfo,
        setAccountInfo,
        keypair,
        credentialsBundle,
        authError,
        authenticate,
        completeLogin,
        register,
        verifyCode,
        verifyCodeAndCreateAccount,
        logout,
        wallet,
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

// ---------------------------------------------------------------------------
// Privy provider — Phase-4 new-stack path. Wraps Privy's email-OTP flow and
// exchanges the resulting ID token for our backend JWT.
//
// Mount requires <PrivyProvider> upstream (see app/_layout.tsx PrivyAppShell);
// the dispatcher above guarantees that's the case.
// ---------------------------------------------------------------------------

function PrivyAuthProvider({ children }: { children: React.ReactNode }) {
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

  // Privy collapses register into the same OTP flow as login; this is a
  // delegating alias so legacy `restore-account.tsx` continues to compile.
  const register = authenticate;

  /**
   * Shared OTP-verify path for both login and register: Privy validates the
   * code, returns the user object; we then ask Privy for the ID token, send
   * it to our backend `/auth/exchange`, persist the returned JWT + user, and
   * mark the session authenticated.
   *
   * Returns `true` on success, `false` on failure (same contract as the
   * legacy `verifyCode`/`verifyCodeAndCreateAccount`).
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
        // Keep the legacy field name alive for screens that still read it.
        // Phase-5 deletes the legacy code that depends on it.
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
          `Privy verifyCode + exchange failed: ${error}. (contexts)/AuthContext.tsx (Privy path)`
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
   * `completeLogin(...)` itself. Under the new path, `useLoginMutation`
   * already invoked `completeOtpAndExchange`-equivalent logic, so this is a
   * lightweight state-sync shim.
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
        // Privy logout is best-effort — log and continue with the local
        // wipe so the user is not stranded if Privy's session ack fails.
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

  // Privy enrolls the passkey in-app during signup. There is no separate
  // pending step the way the Grid flow had — keep `pendingPasskeySetup`
  // always false and `completePasskeySetup` a no-op so consumers don't need
  // a branch.
  const pendingPasskeySetup = false;
  const completePasskeySetup = () => {};

  // Derive the wallet address surfaced to consumers from the union of
  // Privy's embedded wallet (when its async store has resolved) and the
  // local React state (set on completeLogin / verifyCode after the backend
  // exchange returns). Doing this in-render avoids a `setState` inside a
  // `useEffect`, which the new eslint-config-expo bans
  // (`react-hooks/set-state-in-effect`). The render-time derivation is cheap
  // and re-evaluates whenever the embedded wallet's address changes.
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
