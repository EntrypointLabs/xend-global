import React, { useEffect, useState } from "react";
import { Redirect, Slot, useSegments } from "expo-router";
import { View } from "react-native";

import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import "@/global.css";
import "@/utils/cssInteropSetup";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ScreenThemeProvider } from "@/contexts/ScreenThemeContext";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/utils/cn";
import { ModalFlowProvider } from "@/contexts/ModalFlowContext";
import { ToastProvider } from "@/contexts/ToastContext";
import * as Sentry from "@sentry/react-native";
import { sentryApiResponse } from "@/types/Sentry";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

const queryClient = new QueryClient();

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
  const colorScheme = useColorScheme();

  if (isAuthenticated === null) {
    return <LoadingScreen />;
  }

  const inAuthGroup = segments[0] === "(auth)";

  if (!isAuthenticated && !inAuthGroup) {
    return <Redirect href="/login" withAnchor />;
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
          <Slot />
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

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !fontTimeout) {
    return <LoadingScreen />;
  }

  if (!loaded || !!error) {
    return null;
  }

  return (
    <PrivyAppShell>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ThemedRoot>
            <AuthProvider>
              <BottomSheetModalProvider>
                <AuthLayout />
              </BottomSheetModalProvider>
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

  if (!configuredAppId) {
    console.warn(
      "[PrivyAppShell] EXPO_PUBLIC_PRIVY_APP_ID is unset; Privy hooks will not be able to authenticate."
    );
  }

  const appId = configuredAppId ?? "placeholder-app-id-privy-app-id-unset";

  return (
    <PrivyProvider
      appId={appId}
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
