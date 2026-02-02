import React from 'react';
import { View, Image } from 'react-native';
import { Typography } from '../atoms/Typography';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../atoms/HapticPressable';

interface SettingsItemProps {
    icon: any;
    label: string;
    onPress?: () => void;
    showChevron?: boolean;
    color?: string;
}

export function SettingsItem({ icon, label, onPress, showChevron = true, color }: SettingsItemProps) {
    return (
        <HapticPressable
            onPress={onPress}
            className={`flex-row items-center gap-4 py-4 bg-transparent`}
        >

            <Image source={icon} className="size-6" resizeMode='contain' />

            <View className="flex-1">
                <Typography weight="500" className="text-lg text-black" style={{ color }}>
                    {label}
                </Typography>
            </View>
            {showChevron && (
                <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
            )}
        </HapticPressable>
    );
}
