import React, { useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { View, TouchableOpacity, Image, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { Typography } from '@/components/ui/atoms/Typography';
import * as Clipboard from 'expo-clipboard';
import { Ionicons, FontAwesome5, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import HapticPressable from '@/components/ui/atoms/HapticPressable';
import TabHeaderText from '@/components/ui/atoms/TabHeaderText';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { truncateAddress } from '@/utils/helper';
import { TextInput } from 'react-native-gesture-handler';
import { isPublicKey, isSnsName, resolveSnsName } from '@/utils/solana';
import { cn } from '@/utils/class';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';

const solanaAddress = "AtfWTb16gD8P7D975ZwMfUvABZvkqyLCF6wySvpTntZj";

// Mock Recent Addresses
const RECENT_ADDRESSES = [
    {
        address: solanaAddress,
        sends: 2,
        icon: require('@/assets/icons/wallet.png')
    }
];

interface RecipientStepProps {
    onClose: () => void;
    onNext: (recipient: string) => void;
    onScanPress: () => void;
    recipient: string;
    setRecipient: (recipient: string) => void;
}

export default memo(function RecipientStep({ onNext, onScanPress, recipient, setRecipient }: RecipientStepProps) {
    const inputRef = useRef<TextInput | null>(null);
    const debouncedRecipient = useDebounce(recipient, 400)

    const isSns = debouncedRecipient.includes(".")

    const { data: resolvedAddress, isLoading: isResolving, error: resolveError } = useQuery({
        queryKey: ['resolve-solana-name', debouncedRecipient],
        queryFn: () => resolveSnsName(debouncedRecipient),
        enabled: Boolean(debouncedRecipient && !isPublicKey(debouncedRecipient) && isSns),
        retry: (count, error) => {
            if (count > 1) return false;
            if (error?.message === "The name account does not exist") return false;
            return true;
        },
        retryDelay: 2_000,
    })

    const handlePaste = async () => {
        const text = await Clipboard.getStringAsync();
        if (!text) return;
        if (isPublicKey(text)) {
            setRecipient(text);
        }
        const isSns = await isSnsName(text);
        if (isSns) {
            setRecipient(text);
        }
    };

    const handleContinue = useCallback(() => {
        if (isPublicKey(debouncedRecipient)) {
            onNext(debouncedRecipient);
        } else if (resolvedAddress) {
            onNext(resolvedAddress);
        }
    }, [debouncedRecipient, resolvedAddress, onNext]);

    // Focus input on mount
    useEffect(() => {
        const timer = setTimeout(() => {
            inputRef.current?.focus();
        }, 300);
        return () => clearTimeout(timer);
    }, []);

    const { isValid, label, icon } = useMemo(() => {
        if (debouncedRecipient.length === 0) {
            return { isValid: true, label: "Enter Solana address or .sol handle" };
        }

        const sends = 0;
        const sendsLabel = sends === 0 ? "New address" : `${sends} send${sends === 1 ? "" : "s"}`;

        if (isSns) {
            if (isResolving) {
                return { isValid: true, label: "Resolving...", icon: <FontAwesome5 name="spinner" size={14} color="blue" className='animate-spin' /> };
            }
            if (resolveError) {
                const errLabel = resolveError.message === "The name account does not exist" ? "No matching address found" : resolveError.message;
                return { isValid: false, label: errLabel, icon: <MaterialCommunityIcons name="alert-decagram" size={14} color="red" /> };
            }
            if (resolvedAddress) {
                return { isValid: true, label: `${truncateAddress(resolvedAddress)} • ${sendsLabel}`, icon: <MaterialCommunityIcons name="check-decagram" size={14} color="green" /> };
            }
            return { isValid: true, label: "Enter Solana address or .sol handle" };
        }

        if (isPublicKey(debouncedRecipient)) {
            return { isValid: true, label: sendsLabel, icon: <MaterialCommunityIcons name="clock-time-nine" size={14} color="lightgrey" /> };
        }

        return { isValid: false, label: "Invalid Solana address" };
    }, [debouncedRecipient, isResolving, resolveError, resolvedAddress, isSns]);

    const isContinueDisabled = useMemo(() => {
        if (debouncedRecipient.length === 0 || !isValid) return true;
        return !isPublicKey(debouncedRecipient) && !resolvedAddress;
    }, [isValid, debouncedRecipient, resolvedAddress]);


    return (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View className='flex-1 bg-[#F0F0F0]'>
                <View className="flex-row items-center justify-between mb-8 px-4">
                    <View className="w-10 h-10" />
                    <TabHeaderText className="text-center font-semibold">Choose recipient</TabHeaderText>
                    <TouchableOpacity
                        onPress={onScanPress}
                        className="w-10 h-10 items-center justify-center"
                    >
                        <Ionicons name="scan-outline" size={24} color="black" />
                    </TouchableOpacity>
                </View>

                <View className="mx-4 bg-[#F9F9F9] border border-white rounded-[24px] p-4 mb-8">
                    <TouchableOpacity className="bg-transparent relative" onPress={() => inputRef.current?.focus()}>
                        <BottomSheetTextInput
                            className="text-base text-black/90 -ml-1 py-0 mb-1.5 font-medium w-[235px]"
                            placeholder="Address or .sol handle"
                            placeholderTextColor="#0000004D"
                            value={recipient}
                            onChangeText={setRecipient}
                            autoCapitalize="none"
                            autoCorrect={false}
                            ref={inputRef}
                            style={{ fontFamily: 'Inter_500Medium' }}
                            returnKeyType="go"
                            onSubmitEditing={handleContinue}
                            submitBehavior='blurAndSubmit'
                            multiline
                        />
                        <TouchableOpacity onPress={() => inputRef.current?.focus()} className='mb-2.5 flex-row items-center justify-start gap-1'>
                            {icon}
                            <Typography weight="600" className={cn("text-black/30 text-xs", !isValid && "text-red-500")}>{label}</Typography>
                        </TouchableOpacity>

                        {recipient && <HapticPressable className='absolute -right-5 -top-5 z-10 transition-all duration-200 ease-in-out p-5' onPress={() => setRecipient("")}>
                            <Ionicons name="close-circle" size={20} color="lightgrey" />
                        </HapticPressable>}
                    </TouchableOpacity>

                    <View className="flex-row gap-2.5">
                        <HapticPressable
                            className={`px-6 py-[8px] rounded-full ${!isContinueDisabled ? 'bg-black' : 'bg-black/30'}`}
                            onPress={handleContinue}
                            disabled={isContinueDisabled}
                        >
                            <Typography weight="600" className="text-white">Continue</Typography>
                        </HapticPressable>

                        <HapticPressable
                            className="flex-row items-center bg-black/10 px-6 py-[8px] rounded-full gap-1"
                            onPress={handlePaste}
                        >
                            <Ionicons name="document" size={16} color="black" />
                            <Typography weight="600" className="text-black">Paste</Typography>
                        </HapticPressable>
                    </View>
                </View>

                {/* Recent Addresses */}
                <Typography weight="600" className="text-lg mb-4 ml-5">Recent addresses</Typography>

                {RECENT_ADDRESSES.map((item, index) => (
                    <TouchableOpacity
                        key={index}
                        className="flex-row items-center mb-4 mx-5"
                        onPress={() => {
                            setRecipient(item.address);
                            onNext(item.address);
                        }}
                    >
                        <View className="w-12 h-12 rounded-full bg-gray-200/60 items-center justify-center mr-3 border" style={{ borderColor: "#F2F4F7" }}>
                            <MaterialIcons name="wallet" size={22} color="black" />
                        </View>
                        <View>
                            <Typography weight="600" className="text-base">{truncateAddress(item.address)}</Typography>
                            <Typography weight="500" className="text-gray-400 text-sm">{item.sends} sends</Typography>
                        </View>
                    </TouchableOpacity>
                ))}
            </View>
        </TouchableWithoutFeedback>
    );
})
