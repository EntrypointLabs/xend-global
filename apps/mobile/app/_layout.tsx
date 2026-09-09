import { localFiatDemo } from "@/utils/local-fiat-demo";
import React, { useEffect, useMemo, useState } from "react";
import { Redirect, Slot, useSegments } from "expo-router";
import {
  AppState,
  AppStateStatus,
  Platform,
  StyleSheet,
  View,
} from "react-native";

import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import "@/global.css";
import "@/utils/cssInteropSetup";
import { installPrivyRequestLog } from "@/utils/privyRequestLog";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLockProvider, useAppLock } from "@/contexts/AppLockContext";
import { ScreenThemeProvider } from "@/contexts/ScreenThemeContext";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/utils/cn";
import { ModalFlowProvider } from "@/contexts/ModalFlowContext";
import { ToastProvider } from "@/contexts/ToastContext";
import {
  BlurTargetProvider,
  BlurTargetHost,
} from "@/contexts/BlurTargetContext";
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/expo";

import * as SplashScreen from "expo-splash-screen";
import {
  Inter_100Thin,
  Inter_200ExtraLight,
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
  Inter_100Thin_Italic,
  Inter_200ExtraLight_Italic,
  Inter_300Light_Italic,
  Inter_400Regular_Italic,
  Inter_500Medium_Italic,
  Inter_600SemiBold_Italic,
  Inter_700Bold_Italic,
  Inter_800ExtraBold_Italic,
  Inter_900Black_Italic,
  useFonts,
} from "@expo-google-fonts/inter";
import LoadingScreen from "@/components/ui/layout/LoadingScreen";
import LockScreen from "@/components/ui/layout/LockScreen";
import { usePendingWatch } from "@/hooks/useTransfers";
import {
  useNotificationRouting,
  usePushRegistration,
} from "@/hooks/usePushRegistration";

// Runs before any provider mounts, so the first Privy call is already covered.
installPrivyRequestLog();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2 } },
});

/**
 * Bridges React Native's AppState into React Query's focusManager so queries
 * refetch on foreground. `focusManager` handles this via the browser
 * `visibilitychange` event on web, so only wire it up on native.
 */
function ReactQueryFocusBridge() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      focusManager.setFocused(state === "active");
    });
    return () => sub.remove();
  }, []);
  return null;
}

// Keep the native splash up until the app is ready, then hand off to the
// matching JS splash (LoadingScreen) — no white flash in between.
SplashScreen.preventAutoHideAsync();

// Error tracking in release builds only, and only when a DSN is configured.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const SENTRY_ENABLED = !__DEV__ && !!SENTRY_DSN;

if (SENTRY_ENABLED) {
  const app = Constants.expoConfig;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
    release: app?.version ? `${app.slug ?? "xend"}@${app.version}` : undefined,
    dist: app?.ios?.buildNumber ?? app?.android?.versionCode?.toString(),
    sendDefaultPii: true,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    integrations: [
      Sentry.mobileReplayIntegration(),
      Sentry.feedbackIntegration(),
    ],
  });
}

function AuthLayout() {
  const segments = useSegments();
  const { isAuthenticated, needsContactEmail } = useAuth();
  const { isLocked, isObscured } = useAppLock();
  const colorScheme = useColorScheme();

  // The screens are held apart from this component's own renders on purpose.
  // `useSegments()` above changes on every navigation, and without this the
  // whole app below re-rendered each time a tab was tapped: every provider,
  // every mounted screen, the lot. Memoising the element means a navigation
  // re-renders the navigator and the screen it is going to, and nothing else.
  const screens = useMemo(
    () => (
      <ScreenThemeProvider>
        <ModalFlowProvider>
          <ToastProvider>
            <BlurTargetHost>
              <Slot />
            </BlurTargetHost>
            <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
          </ToastProvider>
        </ModalFlowProvider>
      </ScreenThemeProvider>
    ),
    [colorScheme]
  );

  if (localFiatDemo) {
    if (segments[0] === "(fiat)" && (segments[1] === "unified" || segments[1] === "accounts" || segments[1] === "balances" || segments[1] === "naira-send")) return screens;
    if (!isAuthenticated) return <Redirect href="/(fiat)/unified" withAnchor />;
  }

  if (isAuthenticated === null) {
    return <LoadingScreen />;
  }

  const inAuthGroup = segments[0] === "(auth)";
  // Sign-up starts at the address, before there is a session, so the email
  // screen is reachable signed out. It stays outside the auth group because a
  // sign-up finishes on it too, after the session exists.
  const atEmailScreen = segments[0] === "add-email";

  if (!isAuthenticated && !inAuthGroup && !atEmailScreen) {
    return <Redirect href="/login" withAnchor />;
  }

  // Before the tabs, and from anywhere. An Account needs a contact address:
  // the recovery signer is anchored on it, so a signed-in Consumer without one
  // has no Account at all. Deriving this from what is on file rather than from
  // a flag raised during sign-up means an interrupted sign-up resumes instead
  // of leaving somebody on a dashboard nothing has been created for.
  if (isAuthenticated && needsContactEmail && !atEmailScreen) {
    return <Redirect href="/add-email" withAnchor />;
  }

  if (isAuthenticated && inAuthGroup) {
    return <Redirect href="/(tabs)" withAnchor />;
  }

  // App lock: once signed in and out of the auth stack, the biometric unlock
  // overlays the app rather than replacing it — the Slot (and whatever
  // screen/modal was open) stays mounted underneath, so unlocking returns to
  // exactly where the Consumer left off instead of resetting the navigator.
  const showLock = isAuthenticated && !inAuthGroup && isLocked;
  // Covers content the instant the app isn't active (e.g. the OS
  // app-switcher snapshot), even during the grace period where `showLock`
  // hasn't kicked in yet. Skipped once showLock is up — that already covers.
  const showObscure =
    isAuthenticated && !inAuthGroup && isObscured && !showLock;

  // Theming is driven by NativeWind (ThemedRoot's `dark` class) and
  // ScreenThemeProvider; the navigator inherits light/dark from the OS.
  return (
    <>
      {screens}
      {showObscure && (
        <View style={StyleSheet.absoluteFill}>
          <LoadingScreen />
        </View>
      )}
      {showLock && (
        <View style={StyleSheet.absoluteFill}>
          <LockScreen />
        </View>
      )}
    </>
  );
}

function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_100Thin,
    Inter_200ExtraLight,
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
    Inter_100Thin_Italic,
    Inter_200ExtraLight_Italic,
    Inter_300Light_Italic,
    Inter_400Regular_Italic,
    Inter_500Medium_Italic,
    Inter_600SemiBold_Italic,
    Inter_700Bold_Italic,
    Inter_800ExtraBold_Italic,
    Inter_900Black_Italic,
  });

  const [fontTimeout, setFontTimeout] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  const ready = loaded || !!error || fontTimeout;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return <LoadingScreen />;
  }

  return (
    <PrivyAppShell>
      <QueryClientProvider client={queryClient}>
        <ReactQueryFocusBridge />
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ThemedRoot>
            <AuthProvider>
              <ActivityWatch />
              <AppLockProvider>
                <BlurTargetProvider>
                  <BottomSheetModalProvider>
                    <AuthLayout />
                  </BottomSheetModalProvider>
                </BlurTargetProvider>
              </AppLockProvider>
            </AuthProvider>
          </ThemedRoot>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </PrivyAppShell>
  );
}

/**
 * Watches for money arriving, from wherever the Consumer happens to be.
 *
 * Mounted above the screens rather than on one of them: a deposit lands
 * whether or not the activity feed is open, and before this it stayed
 * invisible until something else happened to refetch.
 */
function ActivityWatch() {
  usePendingWatch();
  usePushRegistration();
  useNotificationRouting();
  return null;
}

/**
 * Wraps the app in `<PrivyProvider>`. Privy is the only auth path and requires
 * `EXPO_PUBLIC_PRIVY_APP_ID`; a Solana embedded wallet is created on login.
 */
function PrivyAppShell({ children }: { children: React.ReactNode }) {
  const configuredAppId = process.env.EXPO_PUBLIC_PRIVY_APP_ID;
  const configuredClientId = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID;

  if (!configuredAppId) {
    // A release build with no app id cannot sign anyone in, and a placeholder
    // would only move the failure to the first passkey prompt.
    if (!__DEV__) {
      throw new Error("EXPO_PUBLIC_PRIVY_APP_ID is not set");
    }
    console.warn(
      "[PrivyAppShell] EXPO_PUBLIC_PRIVY_APP_ID is unset; Privy hooks will not be able to authenticate."
    );
  }

  if (!configuredClientId) {
    console.warn(
      "[PrivyAppShell] EXPO_PUBLIC_PRIVY_CLIENT_ID is unset; native builds need the dashboard client ID for the app identifier to be recognized."
    );
  }

  const appId = configuredAppId ?? "placeholder-app-id-privy-app-id-unset";

  return (
    <PrivyProvider
      appId={appId}
      clientId={configuredClientId}
      config={{
        embedded: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

function ThemedRoot({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View className={cn("flex-1", theme === "dark" && "dark")}>{children}</View>
  );
}

export default SENTRY_ENABLED ? Sentry.wrap(RootLayout) : RootLayout;
