import React, { useMemo, useCallback, forwardRef, useState } from 'react';
import { View, StyleSheet, Dimensions, Keyboard } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetBackdropProps
} from '@gorhom/bottom-sheet';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
} from 'react-native-reanimated';
import RecipientStep from './RecipientStep';
import AmountStep from './AmountStep';

export interface SendFlowModalRef {
    present: () => void;
    dismiss: () => void;
}

interface SendFlowModalProps {
    onClose?: () => void;
}

type Step = 'Recipient' | 'Amount';

const SCREEN_WIDTH = Dimensions.get('window').width;

const springConfig = {
    // damping: 20,
    // stiffness: 150
};

export const SendFlowModal = forwardRef<BottomSheetModal, SendFlowModalProps>(({ onClose }, ref) => {
    // variables
    const snapPoints = useMemo(() => ['94%'], []);

    // State
    const [step, setStep] = useState<Step>('Recipient');
    const [recipient, setRecipient] = useState<string>('');

    // Animation
    const translateX = useSharedValue(0);

    const renderBackdrop = useCallback(
        (props: BottomSheetBackdropProps) => (
            <BottomSheetBackdrop
                {...props}
                disappearsOnIndex={-1}
                appearsOnIndex={0}
                opacity={0.5}
            />
        ),
        []
    );

    const handleSheetChanges = useCallback((index: number) => {
        if (index === -1 && onClose) {
            onClose();
            // Reset state on close
            setTimeout(() => {
                setStep('Recipient');
                setRecipient('');
                translateX.value = 0;
            }, 300);
        }
    }, [onClose]);

    const handleNext = (selectedRecipient: string) => {
        setRecipient(selectedRecipient);
        setStep('Amount');

        Keyboard.dismiss()
        translateX.value = withSpring(-SCREEN_WIDTH, springConfig);
    };

    const handleBack = () => {
        setStep('Recipient');
        translateX.value = withSpring(0, springConfig);
    };

    const handleClose = () => {
        // @ts-ignore
        ref?.current?.dismiss();
    };

    const requestLayout = useAnimatedStyle(() => {
        return {
            transform: [{ translateX: translateX.value }],
        };
    });

    return (
        <BottomSheetModal
            ref={ref}
            index={1}
            snapPoints={snapPoints}
            onChange={handleSheetChanges}
            backdropComponent={renderBackdrop}
            enablePanDownToClose={true}
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            handleIndicatorStyle={{ display: 'none' }}
            backgroundStyle={{ backgroundColor: '#F0F0F0' }}

        >
            <BottomSheetView className='h-full flex-1 overflow-hidden bg-[#F0F0F0]'>
                <Animated.View style={[styles.container, requestLayout]}>
                    <View style={styles.screen}>
                        <RecipientStep
                            onClose={handleClose}
                            onNext={handleNext}
                        />
                    </View>
                    <View style={styles.screen}>
                        <AmountStep
                            recipient={recipient}
                            onBack={handleBack}
                            onClose={handleClose}
                        />
                    </View>
                </Animated.View>
            </BottomSheetView>
        </BottomSheetModal>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        width: '200%', // Double width for side-by-side screens
    },
    screen: {
        flex: 1,
        width: '100%',
    }
});
