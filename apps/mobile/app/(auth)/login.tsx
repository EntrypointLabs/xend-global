import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ThemedButton } from '@/components/ui/molecules';
import { Image, Text, View } from 'react-native';
import { WithScreenTheme } from '@/components/WithScreenTheme';
import { useResendTimer } from '@/hooks/useResendTimer';
import { router } from 'expo-router';
import { ErrorCode } from '@/utils/errors';
import { handleError } from '@/utils/errors';
import { useScreenTheme } from '@/contexts/ScreenThemeContext';
import Logo from '@/components/Logo';

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
                    <Text className='text-4xl font-medium'>Invest</Text>
                </View>

                <View className='flex-1 h-full justify-end'>
                    <Logo />
                    <Text className='text-4xl font-medium max-w-[269px] w-full text-white my-[22px]'>
                        Your money, upgraded
                    </Text>
                    <View className='mb-10'>
                        <Text className='text-lg font-medium max-w-[311px] w-full text-[#8FE5F6]'>Save, earn and invest
                        </Text>
                        <Text className='text-lg font-medium max-w-[311px] w-full text-[#8FE5F6]'>with stablecoins and digital assets.</Text>
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