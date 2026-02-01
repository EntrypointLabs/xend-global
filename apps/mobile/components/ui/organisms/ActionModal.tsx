import React, { ReactElement, useEffect } from 'react';
import { Modal, StyleSheet, View, TouchableOpacity, Text, Dimensions, TouchableWithoutFeedback } from 'react-native';
import { BlurView } from 'expo-blur';
import { ThemedText } from '@/components/ui/atoms';
import { useThemeColor } from '@/hooks/useThemeColor';
import { Spacing } from '@/constants/Spacing';
import { useColorScheme } from '@/hooks/useColorScheme';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,

    SlideInDown,
    SlideOutDown,
    FadeIn,
    FadeOut
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';

export interface ActionModalProps {
    visible: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    useStarburstModal?: boolean;
    primaryColor?: string;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = 150;

export function ActionModal({
    visible,
    onClose,
    title = '',
    children,
    useStarburstModal = false,
    primaryColor = '#0080FF'
}: ActionModalProps): ReactElement {
    const backgroundColor = useThemeColor({}, 'background');
    const textColor = useThemeColor({}, 'text');

    const overlayBackgroundColor = 'rgb(189, 189, 189, 1)';
    const blurTint = 'dark';

    const translateY = useSharedValue(0);

    useEffect(() => {
        if (visible) {
            translateY.value = withSpring(0, { damping: 15 });
        } else {
            translateY.value = SCREEN_HEIGHT;
        }
    }, [visible]);

    const handleClose = () => {
        // Reset state and call onClose
        translateY.value = 0; // Reset for next time (though unmount handles it mostly)
        onClose();
    };

    const pan = Gesture.Pan()
        .onChange((event) => {
            if (event.translationY > 0) {
                translateY.value = event.translationY;
            }
        })
        .onEnd((event) => {
            if (event.translationY > SWIPE_THRESHOLD || event.velocityY > 500) {
                runOnJS(handleClose)();
            } else {
                translateY.value = withSpring(0);
            }
        });

    const animatedStyle = useAnimatedStyle(() => {
        return {
            transform: [{ translateY: translateY.value }],
        };
    });

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade" // Fade effectively controls the background blur fade-in
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <GestureHandlerRootView style={{ flex: 1 }}>
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose}>
                    {/* Using TouchableOpacity as backdrop to close on outside press */}
                    <BlurView
                        intensity={24.2}
                        style={[styles.overlay, { backgroundColor: overlayBackgroundColor }, StyleSheet.absoluteFill]}
                        tint={blurTint}
                        experimentalBlurMethod="dimezisBlurView"
                    >
                        <TouchableWithoutFeedback>
                            {/* Prevent touches inside passing to backdrop */}
                            <GestureDetector gesture={pan}>
                                <Animated.View
                                    style={[
                                        styles.modalContainer,
                                        { backgroundColor: useStarburstModal ? '#000' : backgroundColor },
                                        // animatedStyle
                                    ]}
                                // entering={SlideInDown.springify().damping(15)}
                                // exiting={SlideOutDown}
                                >
                                    {title ? (
                                        <View style={styles.header}>
                                            <ThemedText type="subtitle" style={{ color: useStarburstModal ? 'white' : textColor }}>{title}</ThemedText>
                                            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                                                <Text style={[styles.closeText, { color: useStarburstModal ? 'white' : textColor }]}>×</Text>
                                            </TouchableOpacity>
                                        </View>
                                    ) : null}

                                    <View style={styles.contentContainer}>
                                        {children}
                                    </View>
                                </Animated.View>
                            </GestureDetector>
                        </TouchableWithoutFeedback>
                    </BlurView>
                </TouchableOpacity>
            </GestureHandlerRootView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    modalContainer: {
        width: '93%',
        borderRadius: 32,
        paddingHorizontal: 24,
        paddingVertical: 20,
        margin: 21,
        overflow: 'hidden',
        position: 'relative',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: Spacing.sm,
        zIndex: 1,
    },
    contentContainer: {
        zIndex: 1,
    },
    closeButton: {
        opacity: 0.25,
    },
    closeText: {
        fontSize: 28,
        fontWeight: '300',
    },
});