import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { usePrivy } from "@privy-io/expo";

import { AuthStorage } from "@/utils/storage/authStorage";
import { hasLinkedPasskey } from "@/utils/auth";

// Dev-only escape hatch for automated / e2e testing, where a fingerprint can't
// be supplied. Safe to commit: gated behind `__DEV__`, so a release build can
// never bypass the lock even if the env var leaks into production config.
const APP_LOCK_DISABLED =
  __DEV__ && process.env.EXPO_PUBLIC_DISABLE_APP_LOCK === "true";

// How long the app can sit backgrounded before it re-locks on return — long
// enough that opening a link (e.g. the Privacy Policy / Terms & Conditions)
// or a quick app switch doesn't force a fresh Face ID prompt every time.
// Common banking-app grace period; tune here if product wants a different one.
const BACKGROUND_GRACE_PERIOD_MS = 5 * 60 * 1000;

interface AppLockContextType {
  /** True while the authenticated app should stay hidden behind the lock. */
  isLocked: boolean;
  /**
   * True the instant the app isn't fully active (backgrounded, or the OS
   * app-switcher view) — independent of whether the grace period below has
   * actually re-locked yet. Covering content on this, not on `isLocked`, is
   * what keeps the Balance out of the OS app-switcher snapshot.
   */
  isObscured: boolean;
  /** The biometric sheet is currently up. */
  isAuthenticating: boolean;
  /** Lock is on and the persisted preference has loaded — safe to prompt. */
  promptReady: boolean;
  /** Run the biometric check; resolves true once the app is unlocked. */
  authenticate: () => Promise<boolean>;
}

const AppLockContext = createContext<AppLockContextType | undefined>(undefined);

/**
 * Biometric app lock. Once a user has a passkey, the app is protected by the
 * device biometric (Face ID / fingerprint) on cold start and whenever it
 * returns from the background — mirroring the passkey they set up, without
 * touching the Privy session.
 */
export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { user } = usePrivy();

  const [enabled, setEnabled] = useState(false);
  const [resolved, setResolved] = useState(false);
  // Default locked so the app never flashes before the persisted preference
  // loads; the resolve effect drops it for users without a passkey.
  const [isLocked, setIsLocked] = useState(true);
  const [isObscured, setIsObscured] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const authenticatingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AuthStorage.getHasPasskey()
      .then((hasPasskey) => {
        if (cancelled) return;
        setEnabled(hasPasskey);
        setIsLocked(hasPasskey);
        setResolved(true);
      })
      // A failed keychain read must fail open, not strand an authenticated
      // user behind a lock whose prompt never fires. The Privy JWT still
      // guards the session.
      .catch(() => {
        if (cancelled) return;
        setEnabled(false);
        setIsLocked(false);
        setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A passkey on the Privy account is the signal the user opted into biometric
  // protection: turn the lock on (and persist it) without locking mid-session.
  const hasPrivyPasskey = hasLinkedPasskey(user);
  useEffect(() => {
    if (!hasPrivyPasskey) return;
    setEnabled(true);
    AuthStorage.saveHasPasskey(true).catch(() => {});
  }, [hasPrivyPasskey]);

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (authenticatingRef.current) return false;
    authenticatingRef.current = true;
    setIsAuthenticating(true);
    try {
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      // No biometric on the device — don't strand the user behind a lock they
      // can't satisfy; they already cleared email OTP + passkey to get here.
      if (!hasHardware || !isEnrolled) {
        setIsLocked(false);
        return true;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Xend",
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
      });
      if (result.success) {
        setIsLocked(false);
        return true;
      }
      return false;
    } catch {
      // A thrown biometric error is a failed attempt, not an unrecoverable
      // lock — return false so LockScreen shows its retry UI.
      return false;
    } finally {
      authenticatingRef.current = false;
      setIsAuthenticating(false);
    }
  }, []);

  const backgroundedAtRef = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (!enabled) return;

      // Obscure immediately on any non-active state — this covers the OS
      // app-switcher snapshot the instant it's taken, before the grace-
      // period decision below has even run.
      setIsObscured(state !== "active");

      if (authenticatingRef.current) return;

      // Re-lock only once the app has been backgrounded for longer than the
      // grace period — not on the transient 'inactive' state the biometric
      // prompt itself can raise (which would loop the prompt), and not on a
      // brief trip out (e.g. opening the Privacy Policy link) and straight
      // back. Being obscured (above) already covers content during that
      // grace window; this only decides whether Face ID is also required.
      if (state === "background") {
        backgroundedAtRef.current = Date.now();
        return;
      }

      if (state === "active" && backgroundedAtRef.current !== null) {
        const backgroundedFor = Date.now() - backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (backgroundedFor >= BACKGROUND_GRACE_PERIOD_MS) {
          setIsLocked(true);
        }
      }
    });
    return () => sub.remove();
  }, [enabled]);

  return (
    <AppLockContext.Provider
      value={{
        isLocked: APP_LOCK_DISABLED ? false : isLocked,
        isObscured: APP_LOCK_DISABLED ? false : isObscured,
        isAuthenticating,
        promptReady: resolved && enabled,
        authenticate,
      }}
    >
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const context = useContext(AppLockContext);
  if (context === undefined) {
    throw new Error("useAppLock must be used within an AppLockProvider");
  }
  return context;
}
