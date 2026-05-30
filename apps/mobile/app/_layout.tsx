import React, { useEffect, useState } from "react";
import { Redirect, Slot, useSegments } from "expo-router";
import { View } from "react-native";

import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import "@/global.css";
import "@/utils/cssInteropSetup";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@react-navigation/native";
import { lightTheme, darkTheme } from "@/constants/Theme";
import { ScreenThemeProvider } from "@/contexts/ScreenThemeContext";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/utils/cn";
import { ModalFlowProvider } from "@/contexts/ModalFlowContext";
import { ToastProvider } from "@/contexts/ToastContext";
import * as Sentry from "@sentry/react-native";
import { sentryApiResponse } from "@/types/Sentry";
import { EasClient } from "@/utils/easClient";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/expo";
import { useNewStack } from "@/utils/featureFlags";
import { runFirstLaunchWipeIfNeeded } from "@/utils/migration";

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

// Sentry for error tracking
if (process.env.EXPO_PUBLIC_GRID_ENV === "production") {
  const initSentry = async () => {
    try {
      const easClient = new EasClient();
      const response = await easClient.getSentryConfig();
      const sentryConfig = sentryApiResponse.parse(response);

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
  // const router = useRouter();
  const { isAuthenticated, pendingPasskeySetup } = useAuth();
  const colorScheme = useColorScheme();

  // useEffect(() => {
  //   if (isAuthenticated === null) return;

  //   const inAuthGroup = segments[0] === "(auth)";

  //   if (!isAuthenticated && !inAuthGroup) {
  //     router.replace("/login");
  //   } else if (isAuthenticated && !pendingPasskeySetup && inAuthGroup) {
  //     router.replace("/(tabs)");
  //   }
  // }, [isAuthenticated, pendingPasskeySetup, router, segments]);

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

  return (
    <ThemeProvider value={colorScheme === "dark" ? darkTheme : lightTheme}>
      <ScreenThemeProvider>
        <ModalFlowProvider>
          <ToastProvider>
            <Slot />
            <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
          </ToastProvider>
        </ModalFlowProvider>
      </ScreenThemeProvider>
    </ThemeProvider>
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

  // Phase-4 first-launch wipe. Idempotent. No-op when `useNewStack()` is
  // false. Runs once before the AuthProvider's `useEffect` reads from
  // SecureStore, by virtue of being scheduled in the parent component's
  // mount effect — AuthProvider's effect won't run until this render commits.
  // See `apps/mobile/utils/migration.ts`.
  useEffect(() => {
    runFirstLaunchWipeIfNeeded();
  }, []);

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
 * Wraps the app in `<PrivyProvider>` unconditionally so Privy hooks
 * (`useLoginWithEmail`, `useEmbeddedSolanaWallet`, `usePrivy`,
 * `useIdentityToken`) can be called at the top of any component without
 * violating the rules of hooks under the dual-stack dispatch pattern used by
 * `AuthProvider` and `useLoginMutation`.
 *
 * Behaviour:
 *   - `useNewStack()` ON + `EXPO_PUBLIC_PRIVY_APP_ID` set → real Privy app.
 *   - `useNewStack()` OFF or app ID missing → Privy mounts with a placeholder
 *     app ID. The legacy Grid path never invokes Privy methods, so this
 *     produces no user-visible behaviour change vs pre-Phase-4 — the
 *     hooks merely have a valid provider ancestor.
 *
 * The Solana embedded-wallet config is `createOnLogin: 'users-without-wallets'`
 * matching the Phase 1 spike harness shape (`spike/privy-solana/App.tsx`).
 */
function PrivyAppShell({ children }: { children: React.ReactNode }) {
  const isNewStack = useNewStack();
  const configuredAppId = process.env.EXPO_PUBLIC_PRIVY_APP_ID;

  if (isNewStack && !configuredAppId) {
    console.warn(
      "[PrivyAppShell] EXPO_PUBLIC_USE_NEW_STACK=true but EXPO_PUBLIC_PRIVY_APP_ID is unset; Privy hooks will not be able to authenticate."
    );
  }

  // Placeholder used only when Privy will never be invoked (legacy stack
  // without a configured app ID). Privy initialises its provider state lazily;
  // no network call fires until a hook method (`sendCode`, etc.) is called.
  const appId =
    configuredAppId ?? "placeholder-app-id-legacy-stack-no-network-calls";

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
