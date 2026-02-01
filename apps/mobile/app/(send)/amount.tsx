import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { ThemedScreen } from '@/components/ui/layout';
import { Keypad, ThemedButton } from '@/components/ui/molecules';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import TabHeaderText from '@/components/ui/atoms/TabHeaderText';
import { formatAmount } from '@/utils/helper';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletData } from '@/hooks/useWalletData';

export default function AmountScreen() {
    const [amount, setAmount] = useState('0');
    const { recipient } = useLocalSearchParams<{ recipient: string }>();
    const { accountInfo } = useAuth();
    const { balance } = useWalletData(accountInfo);

    const handleKeyPress = (key: string) => {
        if (key === 'backspace') {
            setAmount(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
        } else if (key === '.') {
            if (!amount.includes('.')) setAmount(prev => prev + '.');
        } else {
            if (amount === '0') setAmount(key);
            else {
                const parts = amount.split('.');
                if (parts.length > 1 && parts[1].length >= 2) return;
                setAmount(prev => prev + key);
            }
        }
    };

    const handleContinue = () => {
        // Navigate to Confirm Screen (implementation TBD for next step, using console for now or existing confirm)
        router.push({
            pathname: '/confirm',
            params: {
                amount,
                recipient,
                type: 'wallet',
                title: 'Confirm Transaction'
            }
        });
    };

    return (
        <ThemedScreen useSafeArea={true} safeAreaEdges={['top', 'bottom']}>
            <View className="flex-1 bg-white px-4 pt-2 relative">
                {/* Header */}
                <View className="flex-row items-center justify-between mb-4">
                    <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 items-center justify-center bg-gray-100 rounded-full">
                        <Ionicons name="chevron-back" size={24} color="#999" />
                    </TouchableOpacity>
                    <View className="items-center">
                        <Text className="font-bold text-lg">Enter amount</Text>
                        <Text className="text-gray-400 text-sm">To: {recipient?.slice(0, 4)}...{recipient?.slice(-4)}</Text>
                    </View>
                    <View className="w-10 h-10" />
                </View>

                {/* Amount Display */}
                <View className="flex-1 justify-center items-center -mt-20">
                    <Text className="text-[64px] font-bold text-gray-300 tracking-tight">
                        {amount === '0' ? '0' : formatAmount(amount)}
                    </Text>
                    <View className="flex-row items-center mt-2">
                        <Text className="text-gray-400 text-lg font-medium mr-1">$0</Text>
                    </View>

                    {/* Swap Icon Button */}
                    <TouchableOpacity className="absolute right-0 top-1/2 mt-4 w-10 h-10 bg-white rounded-full items-center justify-center border border-gray-100 shadow-sm">
                        <Ionicons name="swap-vertical" size={20} color="black" />
                    </TouchableOpacity>
                </View>

                {/* Token Selector & Max */}
                <View className="flex-row items-center justify-between bg-[#F9F9F9] rounded-full p-2 mb-8 mx-6">
                    <TouchableOpacity className="flex-row items-center bg-white rounded-full px-3 py-1.5 shadow-sm">
                        <View className="w-5 h-5 bg-blue-500 rounded-full mr-2 items-center justify-center">
                            <Ionicons name="logo-usd" size={12} color="white" />
                        </View>
                        <Text className="font-bold mr-1">USDC</Text>
                        <Ionicons name="chevron-down" size={12} color="black" />
                    </TouchableOpacity>

                    <Text className="text-gray-400 font-medium ml-3 flex-1">{balance ? balance.toFixed(2) : '0.00'} USDC</Text>

                    <TouchableOpacity className="bg-black rounded-full px-4 py-1.5" onPress={() => setAmount(balance.toString())}>
                        <Text className="text-white font-bold text-xs">MAX</Text>
                    </TouchableOpacity>
                </View>


                {/* Keypad */}
                <View className="mb-6">
                    <Keypad onKeyPress={handleKeyPress} />
                </View>

                {/* Review Button */}
                <TouchableOpacity
                    className={`w-full py-4 rounded-full items-center mb-6 ${Number(amount) > 0 ? 'bg-gray-500' : 'bg-gray-300'}`} // Mocking disabled color visual
                    onPress={handleContinue}
                    disabled={Number(amount) <= 0}
                >
                    <Text className="text-white font-bold text-lg">Review</Text>
                </TouchableOpacity>
            </View>
        </ThemedScreen>
    );
}