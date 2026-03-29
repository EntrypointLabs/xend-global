import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ThemedButton } from '@/components/ui/molecules';
import { Image, View } from 'react-native';
import { Typography } from '@/components/ui/atoms/Typography';
import { WithScreenTheme } from '@/components/WithScreenTheme';
import { useResendTimer } from '@/hooks/useResendTimer';
import { router } from 'expo-router';
import { ErrorCode } from '@/utils/errors';
import { handleError } from '@/utils/errors';
import { useScreenTheme } from '@/contexts/ScreenThemeContext';
import Logo from '@/components/Logo';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';

function LoginScreen() {
    const [isLoading, setIsLoading] = useState(false);
    const [showCodeInput, setShowCodeInput] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { authenticate, verifyCode, user } = useAuth();
    const { textColor } = useScreenTheme();

    const triggerAuthentication = async (emailToUse: string) => {

        setShowCodeInput(true);
        await authenticate(emailToUse);
    };

    const handleResend = async () => {
        if (!user?.email) {
            router.push('/(auth)/login');
            return;
        }
        await triggerAuthentication(user.email);
    };

    const { countdown, isDisabled, handleResend: resend } = useResendTimer({
        initialSeconds: 30,
        onResend: handleResend
    });

    const verify = async (code: string): Promise<boolean> => {
        const success = await verifyCode(
            code
        );
        if (success) {
            router.replace('/success');
        }
        return success;
    };

    const handleSubmit = async (submittedEmail: string, code?: string, formError?: string) => {

        try {
            setIsLoading(true);
            setError(null);

            if (formError) {
                console.log('formError', formError);
                setError(formError);
                handleError(ErrorCode.INVALID_EMAIL, true, true);
                return;
            }

            if (code) {
                const isValid = await verify(code);
                if (!isValid) {
                    setError('Invalid code');
                    return;
                }
            } else {
                await triggerAuthentication(submittedEmail);
            }
        } catch (error) {
            setError('An error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <View className='flex-1'>
            <GradientBackround />

            <View className='px-8 py-16 flex-1 justify-between border border-green-950'>
                <View className='flex-1 h-full justify-center'>
                    <RotatingWords />
                </View>

                <View className='flex-1 h-full justify-end'>
                    <Logo />
                    <Typography weight="500" className='text-4xl max-w-[269px] w-full text-white my-[22px]'>
                        Your money, upgraded
                    </Typography>
                    <View className='mb-10'>
                        <Typography weight="500" className='text-lg max-w-[311px] w-full text-[#8FE5F6]'>Save, earn and invest
                        </Typography>
                        <Typography weight="500" className='text-lg max-w-[311px] w-full text-[#8FE5F6]'>with stablecoins and digital assets.</Typography>
                    </View>
                    <View className='gap-2.5'>
                        <ThemedButton onPress={() => authenticate("")} title="Continue with Google"
                            iconLeft={<Image source={require('@/assets/icons/google.png')} className='size-6' />}
                        />
                        <ThemedButton onPress={() => { }} variant='outline' title="Recover existing wallet" iconLeft={<Image source={require('@/assets/icons/redo.png')} className='size-6' />} />
                    </View>
                </View>
            </View>
        </View>
    );
}

const WORDS = [
    { label: 'Spend', icon: 'card-outline' as const },
    { label: 'Invest', icon: 'trending-up-outline' as const },
    { label: 'Pay', icon: 'send-outline' as const },
];

const ITEM_HEIGHT = 48;
const ROTATION_INTERVAL = 2500;

function RotatingWords() {
    const [activeIndex, setActiveIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setActiveIndex(prev => (prev + 1) % WORDS.length);
        }, ROTATION_INTERVAL);
        return () => clearInterval(interval);
    }, []);

    return (
        <View style={{ height: ITEM_HEIGHT * 3 }}>
            {WORDS.map((word, index) => {
                let slot = index - activeIndex;
                if (slot > 1) slot -= WORDS.length;
                if (slot < -1) slot += WORDS.length;

                return (
                    <RotatingWordItem
                        key={word.label}
                        word={word}
                        slot={slot}
                        isActive={slot === 0}
                    />
                );
            })}
        </View>
    );
}

function RotatingWordItem({ word, slot, isActive }: {
    word: (typeof WORDS)[number];
    slot: number;
    isActive: boolean;
}) {
    const targetY = (slot + 1) * ITEM_HEIGHT;
    const animatedY = useSharedValue(targetY);
    const prevSlotRef = useRef(slot);

    useEffect(() => {
        const prevSlot = prevSlotRef.current;
        const newTarget = (slot + 1) * ITEM_HEIGHT;

        if (slot === 1 && prevSlot === -1) {
            // Wrapping from top to bottom: teleport below then animate in
            animatedY.value = 3 * ITEM_HEIGHT;
            animatedY.value = withTiming(newTarget, {
                duration: 500,
                easing: Easing.out(Easing.cubic),
            });
        } else {
            animatedY.value = withTiming(newTarget, {
                duration: 500,
                easing: Easing.out(Easing.cubic),
            });
        }

        prevSlotRef.current = slot;
    }, [slot]);

    const style = useAnimatedStyle(() => ({
        position: 'absolute' as const,
        left: 0,
        height: ITEM_HEIGHT,
        justifyContent: 'center' as const,
        transform: [{ translateY: animatedY.value }],
    }));

    return (
        <Animated.View style={style} className="flex-row items-center">
            {isActive && (
                <Ionicons
                    name={word.icon}
                    size={28}
                    color="black"
                    style={{ marginRight: 10 }}
                />
            )}
            <Typography
                weight="500"
                className={`text-4xl ${isActive ? 'text-black' : 'text-black/30'}`}
            >
                {word.label}
            </Typography>
        </Animated.View>
    );
}

const GradientBackround = () => {
    return (
        <>
            <Image
                source={require('@/assets/images/onboarding/blue-blur-1.png')}
                className='absolute w-full h-[468px] bottom-[58px] left-0'
                resizeMode="stretch"
            />
            <Image
                source={require('@/assets/images/onboarding/blue-blur-2.png')}
                className='absolute w-full h-[468px] bottom-[-17px] left-0'
                resizeMode="cover"
            />
            <Image
                source={require('@/assets/images/onboarding/blue-blur-3.png')}
                className='absolute w-full h-[468px] bottom-[-134px] left-0'
                resizeMode="cover"
            />
        </>
    );
}

export default WithScreenTheme(LoginScreen, {
    backgroundColor: '#FFFFFF',
    textColor: '#000000',
    primaryColor: '#000000'
});