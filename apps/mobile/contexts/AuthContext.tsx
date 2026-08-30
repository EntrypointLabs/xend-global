import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useState,
} from "react";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";
import {
  useEmbeddedSolanaWallet,
  useIdentityToken,
  usePrivy,
} from "@privy-io/expo";

import { AccountInfo, AuthContextType, SessionTier } from "@/types/Auth";
import { AuthStorage } from "@/utils/storage/authStorage";
import { apiClient, apiErrorCode, type EntryProof } from "@/utils/apiClient";
import { isJwtExpired } from "@/utils/jwt";
import { PasskeyHasNoAccountError } from "@/utils/passkeyOutcome";
import { useEnsureSolanaWallet } from "@/hooks/useEnsureSolanaWallet";
import { SEED_DEMO, SEED_USER } from "@/utils/devSeed";
import { forgetThisDevice } from "@/utils/pushDevice";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Privy surfaces the verified email on `linked_accounts`, not at the top level. */
function emailArgFor(privyUser: unknown): string | null {
  const accounts = (privyUser as { linked_accounts?: unknown[] })
    ?.linked_accounts;
  if (!Array.isArray(accounts)) return null;
  const emailAccount = accounts.find(
    (a) => (a as { type?: string })?.type === "email"
  );
  return (emailAccount as { address?: string })?.address ?? null;
}

/**
 * Privy-backed auth provider. Must render inside the `<PrivyProvider>` wrap
 * in `app/_layout.tsx`, since it consumes Privy hooks.
 *
 * Two kinds of session pass through here. A passkey sign-in exchanges a Privy
 * identity for a Xend JWT and is the full session. An email code on an
 * existing account opens an entry session, which is Xend's own token with no
 * Privy session behind it: it can look and start a recovery, and the server
 * refuses everything else. The passkey is what turns the second into the
 * first.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [email, setEmailState] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [needsTokenRefresh, setNeedsTokenRefresh] = useState(false);
  const [sessionTier, setSessionTier] = useState<SessionTier | null>(null);

  /**
   * Records an address the backend has confirmed, in state and in storage.
   *
   * Confirmed is the operative word. This also clears the ask that keeps a
   * Consumer on the contact step, so writing an address here that the backend
   * has not accepted would let somebody past it with no address on file, no
   * Account and no recovery signer. Screens that are still collecting an
   * address keep it in their own state until it comes back saved.
   */
  const setEmail = useCallback((value: string | null) => {
    setEmailState(value);
    setUser((current: { email?: string | null } | null) =>
      current && current.email !== value
        ? { ...current, email: value }
        : current
    );
    if (!value) return;
    void AuthStorage.saveEmail(value).catch((err) =>
      console.warn("[auth] could not persist the contact address", err)
    );
  }, []);

  const queryClient = useQueryClient();

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
      // Demo seed: drop straight into an authed session without Privy/backend.
      if (SEED_DEMO) {
        setUser(SEED_USER);
        setEmail(SEED_USER.email);
        setWallet(SEED_USER.walletAddress);
        setSessionTier("full");
        setIsAuthenticated(true);
        setIsLoading(false);
        return;
      }
      try {
        const storedUser = await AuthStorage.getUser();
        setUser(storedUser);
        const savedEmail = await AuthStorage.getEmail();
        setEmail(savedEmail);

        const token = await AuthStorage.getToken();
        const tier = await AuthStorage.getSessionTier();

        if (tier === "entry") {
          // An entry session has nothing to refresh from: no Privy session
          // stands behind it. Past its hour it is simply over, and the way
          // back in is another code or the passkey.
          const expiresAt = await AuthStorage.getSessionExpiresAt();
          const live =
            !!token &&
            !!expiresAt &&
            new Date(expiresAt).getTime() > Date.now();
          if (live) {
            setWallet(storedUser?.walletAddress ?? null);
            setSessionTier("entry");
            setIsAuthenticated(true);
          } else {
            await AuthStorage.clearAuthData();
            setUser(null);
            setIsAuthenticated(false);
          }
        } else if (token && !isJwtExpired(token)) {
          setSessionTier("full");
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
    // `setEmail` is stable, so this still runs once: it is listed because the
    // wrapper is a callback rather than a state setter the linter knows about.
  }, [setEmail]);

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
        await AuthStorage.saveSessionTier("full");
        await AuthStorage.saveUserData(refreshedUser);
        if (exchange.user.email)
          await AuthStorage.saveEmail(exchange.user.email);
        await AuthStorage.saveIsAuthenticated(true);
        if (cancelled) return;

        setUser(refreshedUser);
        setEmail(exchange.user.email ?? "");
        setWallet(exchange.user.walletAddress);
        setSessionTier("full");
        setIsAuthenticated(true);
      } catch (error) {
        Sentry.captureException(
          new Error(`Silent token refresh failed: ${error}. AuthContext`)
        );
        await AuthStorage.clearAuthData().catch(() => {});
        if (cancelled) return;
        setUser(null);
        setWallet(null);
        setSessionTier(null);
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
   * Turns a Privy identity into the full session: asks Privy for the ID
   * token, sends it to `/auth/exchange`, persists the returned JWT + user, and
   * marks the session authenticated.
   */
  const finalizeSession = async (
    fallbackEmail: string | null,
    signupToken?: string
  ): Promise<boolean> => {
    try {
      // Wait for the embedded Solana wallet to finish provisioning before the
      // exchange, so the backend verifies an identity that already has a linked
      // wallet (a fresh user otherwise races the wallet creation -> 422).
      await ensureSolanaWalletReady();

      const idToken = await getIdentityToken();
      if (!idToken) {
        throw new Error("Privy did not return an identity token");
      }

      let exchange: Awaited<ReturnType<typeof apiClient.exchange>>;
      try {
        exchange = await apiClient.exchange({
          privyIdToken: idToken,
          signupToken,
        });
      } catch (exchangeError) {
        // A passkey no account knows. The credential worked and there is
        // nothing to sign in to; the only next step is the email door, and
        // it must not be papered over with a degraded session.
        if (apiErrorCode(exchangeError) === "NO_ACCOUNT_FOR_PASSKEY") {
          throw new PasskeyHasNoAccountError();
        }

        // Privy has already authenticated the Consumer and provisioned their
        // wallet, so identity is settled; only our JWT is missing. Let them in
        // on a degraded session rather than stranding them at the OTP screen,
        // and let the existing refresh effect pick the JWT up when the backend
        // is reachable again. Balances and activity fall back to Solana RPC in
        // the meantime, so the wallet still works.
        //
        // Not during sign-up. The token is what attaches this passkey to the
        // address that was just proved, and a silent refresh later would
        // exchange without it and start an empty account instead.
        //
        // Not from an entry session either. That session already works for
        // looking; a degraded one would only be a worse version of it.
        const fallbackAddress = embeddedSolana.wallets?.[0]?.address ?? null;
        if (!fallbackAddress || signupToken || sessionTier === "entry") {
          throw exchangeError;
        }

        Sentry.captureException(
          new Error(
            `Backend exchange failed; continuing on a Privy-only session: ${exchangeError}. AuthContext`
          )
        );

        const degradedUser = {
          id: privyUser?.id ?? "",
          email: fallbackEmail ?? email,
          walletAddress: fallbackAddress,
          smart_account_address: fallbackAddress,
        };
        await AuthStorage.saveUserData(degradedUser);
        await AuthStorage.saveIsAuthenticated(true);

        setUser(degradedUser);
        setWallet(fallbackAddress);
        setIsAuthenticated(true);
        setAuthError(null);
        setNeedsTokenRefresh(true);
        return true;
      }

      // The entry token is about to be replaced. Revoked while it can still
      // authenticate, so it is not left live for the rest of its hour.
      if (sessionTier === "entry") {
        await apiClient.signOut().catch(() => undefined);
      }

      await AuthStorage.saveToken(exchange.token);
      await AuthStorage.saveSessionTier("full");
      await AuthStorage.saveUserData({
        id: exchange.user.id,
        email: exchange.user.email,
        walletAddress: exchange.user.walletAddress,
        // KYC screens still read smart_account_address; mirror walletAddress
        // into it so they keep working.
        smart_account_address: exchange.user.walletAddress,
      });
      if (exchange.user.email) await AuthStorage.saveEmail(exchange.user.email);
      await AuthStorage.saveIsAuthenticated(true);

      setUser({
        id: exchange.user.id,
        email: exchange.user.email,
        walletAddress: exchange.user.walletAddress,
        smart_account_address: exchange.user.walletAddress,
      });
      setEmail(exchange.user.email ?? fallbackEmail ?? "");
      setWallet(exchange.user.walletAddress);
      setSessionTier("full");
      setIsAuthenticated(true);
      setAuthError(null);
      return true;
    } catch (error) {
      if (error instanceof PasskeyHasNoAccountError) throw error;
      Sentry.captureException(
        new Error(
          `Privy session finalize failed: ${error}. (contexts)/AuthContext.tsx`
        )
      );
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      setAuthError(errorMessage);
      return false;
    }
  };

  /**
   * Signing in with a passkey alone.
   *
   * Privy has already authenticated by the time this runs; everything after is
   * the same as any other sign-in, which is the point: the credential changes
   * and nothing downstream does. From an entry session this is the upgrade.
   */
  const completePasskeySession = async (
    privyUser: unknown,
    signupToken?: string
  ): Promise<boolean> => finalizeSession(emailArgFor(privyUser), signupToken);

  /**
   * Persisted before any of it reaches React state, and in that order for a
   * reason. Setting the user is what enables every authenticated query, and
   * those read the token straight back out of storage. Flipping state first
   * lets them fire against a token that has not been written yet.
   */
  const enterWithEmail = async (proof: EntryProof): Promise<void> => {
    const entered = {
      id: proof.user.id,
      email: proof.user.email,
      walletAddress: proof.user.walletAddress,
      smart_account_address: proof.user.walletAddress,
    };
    await AuthStorage.saveToken(proof.entryToken);
    await AuthStorage.saveSessionTier("entry");
    await AuthStorage.saveSessionExpiresAt(proof.expiresAt);
    await AuthStorage.saveUserData(entered);
    await AuthStorage.saveEmail(proof.user.email);
    await AuthStorage.saveIsAuthenticated(true);

    setUser(entered);
    setEmail(proof.user.email);
    setWallet(proof.user.walletAddress);
    setSessionTier("entry");
    setIsAuthenticated(true);
    setAuthError(null);
  };

  const logout = async () => {
    setIsLoggingOut(true);
    try {
      if (sessionTier === "entry") {
        // The token is revoked rather than merely forgotten, while it can
        // still authenticate the call that revokes it.
        await apiClient.signOut().catch((err) => {
          if (__DEV__) console.warn("[auth] could not revoke the session", err);
        });
      } else {
        // Before the session is torn down, while the call can still
        // authenticate. Left registered, this phone keeps receiving arrivals
        // for the Consumer who just signed out.
        await forgetThisDevice();
      }

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
      setSessionTier(null);
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

  // Derive the wallet address surfaced to consumers from the union of
  // Privy's embedded wallet and the local React state (set after the backend
  // exchange returns, or from the entry proof). Render-time derivation avoids
  // the banned `setState` inside a `useEffect`.
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
        authError,
        completePasskeySession,
        enterWithEmail,
        logout,
        wallet: effectiveWallet,
        isLoading,
        isLoggingOut,
        sessionTier,
        // Read off the user the backend returned, not the local address, so
        // only an address the backend confirmed counts.
        needsContactEmail: isAuthenticated === true && !user?.email,
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
