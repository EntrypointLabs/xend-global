import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Pressable, Dimensions, Image } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    FadeIn,
    FadeOut,
    SlideInDown,
    SlideOutDown,
    ZoomIn,
    ZoomOut,
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS
} from 'react-native-reanimated';
import { Typography } from '../atoms/Typography';
import { Spacing } from '@/constants/Spacing';
import { useModalFlow } from '@/contexts/ModalFlowContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticPressable from '../atoms/HapticPressable';

interface ActionMenuProps {
    visible: boolean;
    onClose: () => void;
}

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export const ActionMenu: React.FC<ActionMenuProps> = ({ visible, onClose }) => {
    const { showSendModal, showReceiveModal } = useModalFlow();
    const insets = useSafeAreaInsets();

    const menus = useMemo(() => {
        return [
            {
                title: 'Receive',
                icon: require('@/assets/icons/recieve.png'),
                onPress: showReceiveModal,
                disabled: false
            },
            {
                title: 'Send',
                icon: require('@/assets/icons/send.png'),
                onPress: showSendModal,
                disabled: false
            },
            {
                title: 'Swap',
                icon: require('@/assets/icons/swap.png'),
                onPress: () => { },
                disabled: true
            }
        ] as const
    }, [])

    if (!visible) return null;

    return (
        <View style={styles.container}>
            <AnimatedBlurView
                // intensity={24.2}
                intensity={44.2}
                tint="light"
                style={StyleSheet.absoluteFillObject}
                entering={FadeIn}
                exiting={FadeOut}
                experimentalBlurMethod='dimezisBlurView'
            >
                <HapticPressable className='flex-1' onPress={onClose} />
            </AnimatedBlurView>

            <View className='flex flex-col absolute items-end right-4' style={[{ bottom: insets.bottom + Spacing.sm }]}>
                {menus.map((menu) => (
                    <Animated.View
                        entering={SlideInDown.springify(100).damping(20).stiffness(300)}
                        exiting={SlideOutDown.springify(100).damping(20).stiffness(300)}
                        // entering={SlideInDown.delay(100).damping(20).stiffness(300)}
                        // exiting={SlideOutDown.delay(100).damping(20).stiffness(300)}
                        className="items-end"
                        key={menu.title}
                    >
                        <HapticPressable
                            className='flex-row items-center gap-4 py-6'
                            onPress={() => {
                                onClose();
                                setTimeout(menu.onPress, 10);
                            }}
                        >
                            <Typography weight="600" style={styles.menuText}>{menu.title}</Typography>
                            <Image source={menu.icon} className='size-7' resizeMode='contain' />
                        </HapticPressable>
                    </Animated.View>
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1000,
        justifyContent: 'flex-end',
        alignItems: 'flex-end',
    },
    menuContainer: {
        position: 'absolute',
        right: Spacing.md,
        alignItems: 'flex-end',
        gap: 16,
    },
    menuItemWrapper: {
        alignItems: 'flex-end',
    },
    menuText: {
        fontSize: 18,
        color: '#000',
    },
    iconContainer: {
        width: 50,
        height: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    }
});
