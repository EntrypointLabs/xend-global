import React from 'react';
import { TextProps, StyleSheet, TouchableOpacity } from 'react-native';
import { Typography } from './Typography';
import { useScreenTheme } from '@/contexts/ScreenThemeContext';
import { Size, Weight } from '@/constants/Typography';

interface ThemedActionTextProps extends Omit<TextProps, 'style'> {
    onPress?: () => void;
    disabled?: boolean;
    countdown?: number;
    disabledText?: string;
    activeText?: string;
    style?: TextProps['style'];
}

export function ThemedActionText({
    onPress,
    disabled = false,
    countdown,
    disabledText = 'Resend code',
    activeText = 'Resend code',
    style,
    ...props
}: ThemedActionTextProps) {
    const { textColor } = useScreenTheme();

    const getDisplayText = () => {
        if (disabled && countdown !== undefined) {
            return `${disabledText} ${countdown}s`;
        }
        return activeText;
    };

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={disabled}
            style={styles.container}
        >
            <Typography
                weight="500"
                style={[
                    styles.text,
                    {
                        color: disabled ? textColor + '60' : textColor,
                    },
                    style,
                ]}
                {...props}
            >
                {getDisplayText()}
            </Typography>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        fontSize: Size.medium,
    },
}); 