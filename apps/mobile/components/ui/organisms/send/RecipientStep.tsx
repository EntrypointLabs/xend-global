import React, { useState, useRef, useEffect } from 'react';
import { View, TouchableOpacity, Image } from 'react-native';
import { Typography } from '@/components/ui/atoms/Typography';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '@/components/ui/atoms/HapticPressable';
import TabHeaderText from '@/components/ui/atoms/TabHeaderText';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { truncateAddress } from '@/utils/helper';
import { TextInput } from 'react-native-gesture-handler';

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
}

export default function RecipientStep({ onClose, onNext }: RecipientStepProps) {
    const inputRef = useRef<TextInput | null>(null);
    const [recipient, setRecipient] = useState('');

    const handlePaste = async () => {
        const text = await Clipboard.getStringAsync();
        if (text) {
            setRecipient(text);
        }
    };

    const handleContinue = () => {
        if (recipient.length > 0) {
            onNext(recipient);
        }
    };

    // Focus input on mount
    useEffect(() => {
        // Small timeout to allow animation to complete
        const timer = setTimeout(() => {
            inputRef.current?.focus();
        }, 300);
        return () => clearTimeout(timer);
    }, []);


    return (
        <View className='flex-1 bg-[#F0F0F0]'>
            {/* Header */}
            <View className="flex-row items-center justify-between mb-8 px-4">
                <View className="w-10 h-10" />
                <TabHeaderText className="text-center font-semibold">Choose recipient</TabHeaderText>
                <TouchableOpacity
                    onPress={onClose}
                    className="w-10 h-10 items-center justify-center"
                >
                    <Ionicons name="scan-outline" size={24} color="black" />
                </TouchableOpacity>
            </View>

            {/* Input Container */}
            <View className="mx-4 bg-[#F9F9F9] border border-white rounded-[24px] p-4 mb-8">
                <BottomSheetTextInput
                    className="text-base text-black -ml-1 py-0 mb-1.5 font-medium"
                    placeholder="Address or .sol handle"
                    placeholderTextColor="#0000004D"
                    value={recipient}
                    onChangeText={setRecipient}
                    autoCapitalize="none"
                    autoCorrect={false}
                    ref={inputRef}
                    style={{ fontSize: 16, color: 'black', marginBottom: 6, height: 40 }}
                />
                <Typography onPress={() => inputRef.current?.focus()} weight="500" className="text-black/30 text-xs mb-2.5">Enter Solana address or .sol handle</Typography>

                <View className="flex-row gap-3">
                    <HapticPressable
                        className={`px-6 py-2.5 rounded-full ${recipient.length > 0 ? 'bg-black' : 'bg-black/30'}`}
                        onPress={handleContinue}
                        disabled={recipient.length === 0}
                    >
                        <Typography weight="600" className="text-white">Continue</Typography>
                    </HapticPressable>

                    <HapticPressable
                        className="flex-row items-center bg-gray-100 px-4 py-2.5 rounded-full"
                        onPress={handlePaste}
                    >
                        <Ionicons name="document-text-outline" size={16} color="black" style={{ marginRight: 6 }} />
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
                    <View className="w-12 h-12 rounded-full bg-white items-center justify-center mr-3 border border-[#F2F4F7]">
                        <Image source={item.icon} className="w-6 h-6" resizeMode="contain" />
                    </View>
                    <View>
                        <Typography weight="700" className="text-base">{truncateAddress(item.address)}</Typography>
                        <Typography className="text-gray-400 text-sm">{item.sends} sends</Typography>
                    </View>
                </TouchableOpacity>
            ))}
        </View>
    );
}
