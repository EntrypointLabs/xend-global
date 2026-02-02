import React, { useMemo, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Typography } from '@/components/ui/atoms/Typography';
import { Keypad } from '@/components/ui/molecules';
import { Ionicons } from '@expo/vector-icons';
import { formatAmount, truncateAddress } from '@/utils/helper';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletData } from '@/hooks/useWalletData';
import { useRouter } from 'expo-router';
import HapticPressable from '../../atoms/HapticPressable';
import { cn } from '@/utils/class';

interface AmountStepProps {
    recipient: string;
    onBack: () => void;
    onClose: () => void;
}

export default function AmountStep({ recipient, onBack, onClose }: AmountStepProps) {
    const router = useRouter(); // For final navigation to confirm

    const [amount, setAmount] = useState('');
    const { accountInfo } = useAuth();
    const { balance } = useWalletData(accountInfo);

    const handleKeyPress = (key: string) => {
        if (key === 'backspace') {
            setAmount(prev => prev.length > 1 ? prev.slice(0, -1) : '');
        } else if (key === '.') {
            if (!amount) {
                setAmount('0.');
                return;
            }
            if (!amount.includes('.')) setAmount(prev => prev + '.');
        } else {
            if (amount === '0') setAmount(key);
            else {
                const parts = amount.split('.');
                if (parts.length > 1 && parts[1].length >= 8) return;
                setAmount(prev => prev + key);
            }
        }
    };

    const handleContinue = () => {
        onClose(); // Close the bottom sheet flow
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

    const { status, label } = useMemo(() => {
        let label = 'Review';
        let status = 'idle'
        if (amount && Number(amount) > Number(balance)) {
            label = 'Insufficient balance';
            status = 'error'
        }

        if (Number(amount) > 0 && Number(amount) <= Number(balance)) {
            label = 'Review';
            status = 'ready'
        }

        return { status, label };
    }, [balance, amount])

    const formattedAmount = useMemo(() => {
        if (amount === '') return '0';
        // if (amount === '0.') return amount;
        if (amount.endsWith('.')) {
            const [int] = amount.split(".");
            return formatAmount({ amount: int, minimumFractionDigits: 0, maximumFractionDigits: 8 }) + '.';
        };
        return formatAmount({ amount, minimumFractionDigits: 0, maximumFractionDigits: 8 })
    }, [amount]);

    return (
        <View className="flex-1 bg-[#F0F0F0]">
            <View className="flex-1 px-4 mb-6 relative">
                {/* Header */}
                <View className="flex-row items-center justify-between mb-4">
                    <TouchableOpacity
                        onPress={onBack}
                        className="w-10 h-10 items-center justify-center bg-gray-100 rounded-full"
                    >
                        <Ionicons name="chevron-back" size={24} color="#999" />
                    </TouchableOpacity>
                    <View className="items-center">
                        <Typography weight="700" className="text-lg">Enter amount</Typography>
                        <Typography className="text-gray-400 text-sm">To: {truncateAddress(recipient)}</Typography>
                    </View>
                    <View className="w-10 h-10" />
                </View>

                {/* Amount Display */}
                <View className="flex-1 justify-center items-center -mt-10">
                    <Typography weight="700" className={cn("text-7xl tracking-tight", !amount ? 'text-gray-300' : 'text-black')}>
                        {formattedAmount}
                    </Typography>
                    {/* <View className="flex-row items-center mt-2">
                        <Text className="text-gray-400 text-lg font-medium mr-1">$0</Text>
                    </View> */}

                    {/* Swap Icon Button */}
                    {/* <TouchableOpacity className="absolute right-0 top-1/2 mt-4 w-10 h-10 bg-white rounded-full items-center justify-center border border-gray-100 shadow-sm">
                        <Ionicons name="swap-vertical" size={20} color="black" />
                    </TouchableOpacity> */}
                </View>

                {/* Token Selector & Max */}
                <View className="flex-row items-center justify-between bg-[#F9F9F9] rounded-full p-2 mb-8 mx-6">
                    <TouchableOpacity className="flex-row items-center bg-white rounded-full px-3 py-1.5 shadow-sm">
                        <View className="w-5 h-5 bg-blue-500 rounded-full mr-2 items-center justify-center">
                            <Ionicons name="logo-usd" size={12} color="white" />
                        </View>
                        <Typography weight="700" className="mr-1">USDC</Typography>
                        <Ionicons name="chevron-down" size={12} color="black" />
                    </TouchableOpacity>

                    <Typography weight="500" className="text-gray-400 ml-3 flex-1">{balance ? balance.toFixed(2) : '0.00'} USDC</Typography>

                    <TouchableOpacity className="bg-black rounded-full px-4 py-1.5" onPress={() => setAmount(balance.toString())}>
                        <Typography weight="700" className="text-white text-xs">MAX</Typography>
                    </TouchableOpacity>
                </View>


                {/* Keypad */}
                <View className="mb-2">
                    <Keypad onKeyPress={handleKeyPress} />
                </View>

                {/* Review Button */}
                <HapticPressable
                    className={cn('w-full py-4 rounded-full items-center mb-2 bg-black', {
                        'opacity-70': status === 'idle',
                        'opacity-100': status === 'ready',
                        'bg-red-500/30': status === 'error'
                    })}
                    onPress={handleContinue}
                    disabled={status === 'error' || status === 'idle'}
                >
                    <Typography weight="500" className={cn("text-white text-base", status === 'error' && 'text-red-500')}>{label}</Typography>
                </HapticPressable>
            </View>
        </View>
    );
}
