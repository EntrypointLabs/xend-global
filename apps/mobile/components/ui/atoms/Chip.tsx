import React from 'react';
import { View, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Typography } from './Typography';
import { useScreenTheme } from '@/contexts/ScreenThemeContext';
import { Spacing } from '@/constants/Spacing';

interface ChipProps {
    children: React.ReactNode;
    style?: ViewStyle;
    textStyle?: TextStyle;
}

export function Chip({ children, style, textStyle }: ChipProps) {
    const { textColor } = useScreenTheme();

    return (
        <View style={[styles.chip, style, { borderColor: textColor + 10 }]}>
            <Typography style={[{ color: textColor }, textStyle]}>{children}</Typography>
        </View>
    );
}

const styles = StyleSheet.create({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 20,
        borderWidth: 1,
        paddingVertical: Spacing.sm,
        paddingHorizontal: 14,
    },
}); 