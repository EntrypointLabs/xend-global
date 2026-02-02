import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from '@/components/LoginForm';
import { ScreenHeaderText } from '@/components/ui/molecules';
import { Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Typography } from '@/components/ui/atoms/Typography';
import { WithScreenTheme } from '@/components/WithScreenTheme';
import { ThemedScreen, StarburstBackground } from '@/components/ui/layout';
import { ThemedActionText, ThemedText } from '@/components/ui/atoms';
import { useResendTimer } from '@/hooks/useResendTimer';
import { Spacing } from '@/constants/Spacing';
import { router } from 'expo-router';
import { ErrorCode } from '@/utils/errors';
import { handleError } from '@/utils/errors';
import { useScreenTheme } from '@/contexts/ScreenThemeContext';

function RestoreAccountScreen() {
    const [isLoading, setIsLoading] = useState(false);
    const [showCodeInput, setShowCodeInput] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // const [otpId, setOtpId] = useState<string | null>(null);
    const { register, verifyCodeAndCreateAccount, user, setEmail, isAuthenticated } = useAuth();
    const { textColor } = useScreenTheme();

    const triggerSignUp = async (emailToUse: string) => {

        setShowCodeInput(true);
        const result = await register(emailToUse);
    };

    const handleResend = async () => {
        if (!user) {
            router.push('/(auth)/login');
            return;
        }
        await triggerSignUp(user.email!);
    };

    const { countdown, isDisabled, handleResend: resend } = useResendTimer({
        initialSeconds: 30,
        onResend: handleResend
    });

    const verify = async (code: string): Promise<boolean> => {
        const success = await verifyCodeAndCreateAccount(
            code,
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
            setEmail(submittedEmail);

            if (formError) {
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
                // Navigate to success after successful account creation
                router.replace('/success');
            } else {
                await triggerSignUp(submittedEmail);
            }
        } catch (error) {
            setError('An error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <ThemedScreen>
            <Image
                source={require('@/assets/images/onboarding/purple-blur.png')}
                style={{
                    position: 'absolute',
                    width: '100%',
                    // height: 323,
                    height: 450,
                    // top: -171,            
                    top: -100,
                    left: 0,
                }}

                resizeMode="cover"
            />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
                style={styles.contentContainer}
            >

                <View className='px-10 py-16 flex-1 justify-between' style={{ flex: 1 }}>
                    <Typography weight="500" className='text-white text-xl max-w-[90px] w-full'>Secure your wallet</Typography>
                    <View>
                        <LoginForm
                            onSubmit={handleSubmit}
                            isLoading={isLoading}
                            error={error}
                        />
                        {/* <View style={[styles.headerContainer, { alignItems: 'flex-start', marginTop: Spacing.lg, paddingHorizontal: Spacing.lg, marginBottom: Spacing.lg, flexDirection: 'row', gap: Spacing.sm }]}>
                            <ThemedText type="default" style={{ color: textColor + 40, paddingVertical: Spacing.xs, marginTop: Spacing.xxs }}>Already have an account?</ThemedText>
                            <Pressable onPress={() => router.push('/(auth)/login')}>
                                <ThemedText type="link" style={{ color: textColor }}>Log in</ThemedText>
                            </Pressable>
                        </View> */}
                    </View>
                </View>


                {/* {showCodeInput && !isLoading && (
                        <View style={styles.actionContainer}>
                            <ThemedActionText
                                onPress={resend}
                                disabled={isDisabled}
                                countdown={countdown}
                                activeText="Resend code"
                                disabledText="Resend code in"
                            />
                        </View>
                    )} */}
            </KeyboardAvoidingView>
        </ThemedScreen>
    );
}

export default WithScreenTheme(RestoreAccountScreen, {

    backgroundColor: '#FFFFFF',
    textColor: '#000000',
    primaryColor: '#000000'
});

const styles = StyleSheet.create({
    contentContainer: {
        flex: 1,
        zIndex: 1,
    },
    headerContainer: {
        justifyContent: 'flex-start',
        alignItems: 'center',
        marginBottom: Spacing.lg * 3,
    },
    actionContainer: {
        flex: 0.1,
        alignItems: 'center',
    },
});
