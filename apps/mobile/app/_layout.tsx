import React, { useEffect, useState } from "react";
import { Redirect, Slot, useSegments } from "expo-router";
import { AppState, AppStateStatus, Platform, View } from "react-native";

import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import "@/global.css";
import "@/utils/cssInteropSetup";
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
import { sentryApiResponse } from "@/types/Sentry";
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

// Error tracking, production only. Config is fetched from the `/api/sentry`
// route so it can be rotated without an app rebuild.
if (process.env.EXPO_PUBLIC_GRID_ENV === "production") {
  const initSentry = async () => {
    try {
      const res = await fetch("/api/sentry");
      const raw = await res.json();
      const sentryConfig = sentryApiResponse.parse(raw);

      Sentry.init({
        ...sentryConfig,
        integrations: [
          Sentry.mobileReplayIntegration(),
          Sentry.feedbackIntegration(),
        ],
      });
    } catch (error) {
      console.error("Failed to initialize Sentry:", error);
    }
  };

  initSentry();
}

function AuthLayout() {
  const segments = useSegments();
  const { isAuthenticated, pendingPasskeySetup } = useAuth();
  const { isLocked } = useAppLock();
  const colorScheme = useColorScheme();

  if (isAuthenticated === null) {
    return <LoadingScreen />;
  }

  const inAuthGroup = segments[0] === "(auth)";

  if (!isAuthenticated && !inAuthGroup) {
    return <Redirect href="/login" withAnchor />;
  }

  // App lock: once signed in and out of the auth stack, require the biometric
  // unlock before any app content renders.
  if (isAuthenticated && !inAuthGroup && isLocked) {
    return <LockScreen />;
  }

  if (isAuthenticated && !pendingPasskeySetup && inAuthGroup) {
    return <Redirect href="/(tabs)" withAnchor />;
  }

  // Theming is driven by NativeWind (ThemedRoot's `dark` class) and
  // ScreenThemeProvider; the navigator inherits light/dark from the OS.
  return (
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
 * Wraps the app in `<PrivyProvider>`. Privy is the only auth path and requires
 * `EXPO_PUBLIC_PRIVY_APP_ID`; a Solana embedded wallet is created on login.
 */
function PrivyAppShell({ children }: { children: React.ReactNode }) {
  const configuredAppId = process.env.EXPO_PUBLIC_PRIVY_APP_ID;
  const configuredClientId = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID;

  if (!configuredAppId) {
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

export default process.env.EXPO_PUBLIC_GRID_ENV === "production"
  ? Sentry.wrap(RootLayout)
  : RootLayout;
