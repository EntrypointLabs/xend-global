import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform, ToastAndroid, Alert } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing } from '@/constants/Spacing';
import { useThemeColor } from '@/hooks/useThemeColor';
import { useModalFlow } from '@/contexts/ModalFlowContext';
import History from '../atoms/icons/history';
import Home from '../atoms/icons/home';
import Settings from '../atoms/icons/settings';
import * as Haptics from 'expo-haptics';
import { ActionPill } from '../molecules';
import HapticPressable from '../atoms/HapticPressable';

import { BlurView } from 'expo-blur';

const iconMappings = {
    index: Home,
    settings: Settings,
    history: History,
} as Record<string, React.FC<{ isActive?: boolean }>>;

export function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
    const primaryColor = useThemeColor({}, 'primary');
    const backgroundColor = useThemeColor({}, 'background');
    const cardColor = useThemeColor({}, 'card');
    const { showReceiveModal } = useModalFlow();

    return (
        <BlurView intensity={10} tint="light" style={[styles.container, { bottom: insets.bottom + Spacing.sm }]}>
            {/* Left Pill - Navigation Tabs */}
            <ActionPill
                items={state.routes.map((route, index) => {
                    const { options } = descriptors[route.key];
                    const isFocused = state.index === index;

                    const onPress = () => {
                        const event = navigation.emit({
                            type: 'tabPress',
                            target: route.key,
                            canPreventDefault: true,
                        });

                        if (!isFocused && !event.defaultPrevented) {
                            navigation.navigate(route.name);
                        }
                    };

                    const onLongPress = () => {
                        navigation.emit({
                            type: 'tabLongPress',
                            target: route.key,
                        });
                    };

                    return {
                        icon: iconMappings[route.name],
                        onPress,
                        onLongPress,
                        isActive: isFocused,
                        accessibilityLabel: options.tabBarAccessibilityLabel,
                        testID: options.title,
                    };
                })}
            />

            {/* Right FAB - Action Button */}
            <HapticPressable
                style={[styles.fab, { backgroundColor: '#000' }]}
                onPress={() => {
                    // Open Send/Receive modal (or mapped action)
                    // For this task, connecting to showReceiveModal as an example or primary action
                    showReceiveModal();
                }}
            >
                <Ionicons name="add" size={32} color="white" />
            </HapticPressable>
        </BlurView>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        left: Spacing.md,
        right: Spacing.md,
        // backgroundColor: 'rgba(255, 255, 255, 1)'
        // backgroundColor: 'rgba(0, 0, 0, 1)'
    },
    tabContainer: {
        // Shadow
        // shadowColor: "#000",
        // shadowOffset: {
        //     width: 0,
        //     height: 4,
        // },
        // shadowOpacity: 0.1,
        // shadowRadius: 12,
        // elevation: 5,
    },
    tabButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    fab: {
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 6,
    }
});
