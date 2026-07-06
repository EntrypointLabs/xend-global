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

interface AppLockContextType {
  /** True while the authenticated app should stay hidden behind the lock. */
  isLocked: boolean;
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

  // Re-lock when the app is backgrounded — but not on the transient 'inactive'
  // state the biometric prompt itself can raise, which would loop the prompt.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "background" && enabled && !authenticatingRef.current) {
        setIsLocked(true);
      }
    });
    return () => sub.remove();
  }, [enabled]);

  return (
    <AppLockContext.Provider
      value={{
        isLocked: APP_LOCK_DISABLED ? false : isLocked,
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
