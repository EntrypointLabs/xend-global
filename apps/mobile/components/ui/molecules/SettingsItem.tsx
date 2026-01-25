import React, { ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColor } from '@/hooks/useThemeColor';

interface SettingsItemProps {
    icon: ReactNode;
    label: string;
    onPress?: () => void;
    showChevron?: boolean;
    isLast?: boolean;
}

export function SettingsItem({ icon, label, onPress, showChevron = true, isLast = false }: SettingsItemProps) {
    const textColor = useThemeColor({}, 'text');

    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.7}
            className={`flex-row items-center py-4 bg-transparent`}
        >
            <View className="mr-4">
                {icon}
            </View>
            <View className="flex-1">
                <Text
                    className="text-base font-medium"
                    style={{ color: textColor }}
                >
                    {label}
                </Text>
            </View>
            {showChevron && (
                <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
            )}
        </TouchableOpacity>
    );
}
