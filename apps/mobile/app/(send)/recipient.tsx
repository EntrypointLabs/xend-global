import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/layout';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColor } from '@/hooks/useThemeColor';
import HapticPressable from '@/components/ui/atoms/HapticPressable';
import TabHeaderText from '@/components/ui/atoms/TabHeaderText';

// Mock Recent Addresses
const RECENT_ADDRESSES = [
    {
        name: 'AtfW...8DtK',
        sends: '2 sends',
        icon: require('@/assets/icons/wallet.png')
    }
];

export default function ChooseRecipientScreen() {
    const router = useRouter();
    const [recipient, setRecipient] = useState('');
    const backgroundColor = useThemeColor({}, 'background');

    const handlePaste = async () => {
        const text = await Clipboard.getStringAsync();
        if (text) {
            setRecipient(text);
        }
    };

    const handleContinue = () => {
        if (recipient.length > 0) {
            router.push({
                pathname: '/(send)/amount',
                params: { recipient: recipient }
            });
        }
    };

    return (
        <ScreenLayout>
            <View className="flex-1 px-4 pt-4">
                {/* Header */}
                <View className="flex-row items-center justify-between mb-8">
                    <View className="w-10 h-10" />
                    <TabHeaderText className="text-center">Choose recipient</TabHeaderText>
                    <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 items-center justify-center">
                        <Ionicons name="scan-outline" size={24} color="black" />
                    </TouchableOpacity>
                </View>

                {/* Input Container */}
                <View className="bg-white rounded-[24px] p-4 mb-8">
                    <Text className="text-gray-400 text-base mb-2">Address or .sol handle</Text>
                    <TextInput
                        className="text-base text-black mb-4 h-10"
                        placeholder="Enter Solana address or .sol handle"
                        placeholderTextColor="#999"
                        value={recipient}
                        onChangeText={setRecipient}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />

                    <View className="flex-row gap-3">
                        <HapticPressable
                            className={`px-6 py-2.5 rounded-full ${recipient.length > 0 ? 'bg-black' : 'bg-black/30'}`}
                            onPress={handleContinue}
                            disabled={recipient.length === 0}
                        >
                            <Text className="text-white font-semibold">Continue</Text>
                        </HapticPressable>

                        <HapticPressable
                            className="flex-row items-center bg-gray-100 px-4 py-2.5 rounded-full"
                            onPress={handlePaste}
                        >
                            <Ionicons name="document-text-outline" size={16} color="black" style={{ marginRight: 6 }} />
                            <Text className="font-semibold text-black">Paste</Text>
                        </HapticPressable>
                    </View>
                </View>

                {/* Recent Addresses */}
                <Text className="font-semibold text-lg mb-4 ml-1">Recent addresses</Text>

                {RECENT_ADDRESSES.map((item, index) => (
                    <TouchableOpacity
                        key={index}
                        className="flex-row items-center mb-4"
                        onPress={() => setRecipient(item.name)}
                    >
                        <View className="w-12 h-12 rounded-full bg-white items-center justify-center mr-3 border border-[#F2F4F7]">
                            <Image source={item.icon} className="w-6 h-6" resizeMode="contain" />
                        </View>
                        <View>
                            <Text className="font-bold text-base">{item.name}</Text>
                            <Text className="text-gray-400 text-sm">{item.sends}</Text>
                        </View>
                    </TouchableOpacity>
                ))}
            </View>
        </ScreenLayout>
    );
}
