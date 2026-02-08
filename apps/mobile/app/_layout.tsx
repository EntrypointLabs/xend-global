// import '@/polyfills';
import React, { useEffect } from 'react';
import { Stack, Slot, useRouter, useSegments } from 'expo-router';
import Toast from 'react-native-toast-message';
import { View } from 'react-native';
import { Typography } from '@/components/ui/atoms/Typography';

import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import "@/global.css";
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ThemeProvider } from '@react-navigation/native';
import { lightTheme, darkTheme } from '@/constants/Theme';
import { ScreenThemeProvider } from '@/contexts/ScreenThemeContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ModalFlowProvider } from '@/contexts/ModalFlowContext';
import { ToastProvider } from '@/contexts/ToastContext';
import * as Sentry from '@sentry/react-native';
import { sentryApiResponse } from '@/types/Sentry';
import { EasClient } from '@/utils/easClient';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as SplashScreen from 'expo-splash-screen';
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
    useFonts
} from '@expo-google-fonts/inter';

const queryClient = new QueryClient();

// Sentry for error tracking
if (process.env.EXPO_PUBLIC_GRID_ENV === 'production') {
    const initSentry = async () => {
        try {
            const easClient = new EasClient();
            const response = await easClient.getSentryConfig();
            const sentryConfig = sentryApiResponse.parse(response);

            Sentry.init({
                ...sentryConfig,
                integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],
            });
        } catch (error) {
            console.error('Failed to initialize Sentry:', error);

        }
    };

    initSentry();
}

function AuthLayout() {
    const segments = useSegments();
    const router = useRouter();
    const { isAuthenticated } = useAuth();
    const colorScheme = useColorScheme();



    useEffect(() => {
        if (isAuthenticated === null) return;

        const inAuthGroup = segments[0] === '(auth)';

        if (!isAuthenticated && !inAuthGroup) {
            // Redirect to the sign-in page
            router.replace('/login');
        } else if (isAuthenticated && inAuthGroup) {
            // Redirect away from the sign-in page
            router.replace('/(tabs)');
        }
    }, [isAuthenticated, segments]);

    return (
        <ThemeProvider value={colorScheme === 'dark' ? darkTheme : lightTheme}>
            <ScreenThemeProvider>
                <ModalFlowProvider>
                    <ToastProvider>
                        <Slot />
                        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
                        <Toast config={toastConfig} />
                    </ToastProvider>
                </ModalFlowProvider>
            </ScreenThemeProvider>
        </ThemeProvider>
    );
}

const toastConfig = {
    error: (props: { text1?: string }) => (
        <View style={{
            backgroundColor: '#000000',
            opacity: 0.4,
            padding: 16,
            borderRadius: 8,
            marginHorizontal: 16,
            marginTop: 40,
            shadowColor: "#000",
            shadowOffset: {
                width: 0,
                height: 2,
            },
            shadowOpacity: 0.25,
            shadowRadius: 3.84,
            elevation: 5,
        }}>
            <Typography weight="600" style={{
                color: '#FFFFFF',
                fontSize: 14,
            }}>
                {props.text1 || 'An error occurred'}
            </Typography>
        </View>
    )
};

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

    useEffect(() => {
        if (loaded || error) {
            SplashScreen.hideAsync();
        }
    }, [loaded, error]);

    if (!loaded && !error) {
        return null;
    }

    return (
        <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <AuthProvider>
                    <BottomSheetModalProvider>
                        <AuthLayout />
                    </BottomSheetModalProvider>
                </AuthProvider>
            </GestureHandlerRootView>
        </QueryClientProvider>
    );
}

export default process.env.EXPO_PUBLIC_GRID_ENV === 'production' ? Sentry.wrap(RootLayout) : RootLayout;