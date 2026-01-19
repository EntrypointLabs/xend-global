import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { IconSymbol, HapticTab } from '@/components/ui/atoms';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { CustomTabBar } from '@/components/ui/organisms';

export default function TabLayout() {
    return (
        <ProtectedRoute>
            <Tabs
                tabBar={props => <CustomTabBar {...props} />}
                screenOptions={{
                    headerShown: false,
                }}>
                <Tabs.Screen
                    name="index"
                    options={{
                        title: 'Home',
                    }}
                />
                <Tabs.Screen
                    name="history"
                    options={{
                        title: 'History',
                    }}
                />
                <Tabs.Screen
                    name="settings"
                    options={{
                        title: 'Settings',
                    }}
                />
            </Tabs>
        </ProtectedRoute>
    );
}
