import React from 'react';
import { View, StyleSheet } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing } from '@/constants/Spacing';
import { useModalFlow } from '@/contexts/ModalFlowContext';
import History from '../atoms/icons/history';
import Home from '../atoms/icons/home';
import Settings from '../atoms/icons/settings';
import { ActionPill } from '../molecules';
import HapticPressable from '../atoms/HapticPressable';

import { BlurView } from 'expo-blur';
import { useSegments } from 'expo-router';

const iconMappings = {
    index: Home,
    settings: Settings,
    history: History,
} as Record<string, React.FC<{ isActive?: boolean }>>;

export function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
    const segments = useSegments();
    const { showReceiveModal } = useModalFlow();

    const isHome = segments[0] === '(tabs)' && segments[1] === undefined;

    return (
        <ContainerWrapper withBlur={!isHome}>
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
                containerStyle={isHome ? { shadowColor: "transparent", elevation: 0 } : {}}
            />

            {/* Right FAB - Action Button */}
            {isHome && <HapticPressable
                style={[styles.fab, { backgroundColor: '#000' }]}
                onPress={() => {
                    // Open Send/Receive modal (or mapped action)
                    // For this task, connecting to showReceiveModal as an example or primary action
                    showReceiveModal();
                }}
            >
                <Ionicons name="add" size={28} color="white" />
            </HapticPressable>}
        </ContainerWrapper>
    );
}

const ContainerWrapper = ({ children, withBlur }: { children: React.ReactNode, withBlur?: boolean }) => {
    const insets = useSafeAreaInsets();
    if (!withBlur) {
        return (
            <View style={[styles.container, { bottom: insets.bottom + Spacing.sm }]}>
                {children}
            </View>
        )
    }
    return (
        <BlurView intensity={10} tint="light" style={[styles.container, { bottom: insets.bottom + Spacing.sm }]} experimentalBlurMethod='dimezisBlurView'>
            {children}
        </BlurView>
    )
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingLeft: Spacing.md,
        paddingRight: Spacing.md,
        left: 0,
        right: 0,
        paddingTop: 10,
        // backgroundColor: 'red',
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
        width: 50,
        height: 50,
        borderRadius: 28,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'absolute',
        // bottom: 0,
        top: 12,
        right: Spacing.md,

        // shadowColor: "#000",
        // shadowOffset: {
        //     width: 0,
        //     height: 4,
        // },
        // shadowOpacity: 0.2,
        // shadowRadius: 8,
        // elevation: 6,
    }
});
