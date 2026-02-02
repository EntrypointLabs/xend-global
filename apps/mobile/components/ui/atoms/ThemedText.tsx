import React from 'react';
import { TextProps, StyleSheet } from 'react-native';
import { useScreenTheme } from '@/contexts/ScreenThemeContext';
import { Height, Size } from '@/constants/Typography';
import { Typography, TypographyProps } from './Typography';

export type ThemedTextProps = TextProps & {
    type?: 'default' | 'highlight' | 'defaultSemiBold' | 'subtitle' | 'link' | 'jumbo' | 'regular' | 'regularSemiBold' | 'tiny' | 'large' | 'small';
};

// Map text types to font weights
const typeToWeight: Record<string, TypographyProps['weight']> = {
    tiny: '500',
    regular: '500',
    regularSemiBold: '600',
    default: '400',
    defaultSemiBold: '600',
    highlight: '700',
    large: '600',
    jumbo: '700',
    subtitle: '600',
    link: '400',
    small: '400',
};

export function ThemedText({
    children,
    style,
    type = 'default',
    ...props
}: ThemedTextProps) {
    const { textColor } = useScreenTheme();

    return (
        <Typography
            weight={typeToWeight[type]}
            style={[
                { color: textColor },
                type === 'default' ? styles.default : undefined,
                type === 'highlight' ? styles.highlight : undefined,
                type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
                type === 'subtitle' ? styles.subtitle : undefined,
                type === 'link' ? styles.link : undefined,
                type === 'jumbo' ? styles.jumbo : undefined,
                type === 'regular' ? styles.regular : undefined,
                type === 'regularSemiBold' ? styles.regularSemiBold : undefined,
                type === 'tiny' ? styles.tiny : undefined,
                type === 'large' ? styles.large : undefined,
                type === 'small' ? styles.small : undefined,
                style
            ]}
            {...props}
        >
            {children}
        </Typography>
    );
}

const styles = StyleSheet.create({
    tiny: {
        fontSize: Size.tiny,
        lineHeight: Size.tiny * Height.lineHeightTight,
    },
    regular: {
        fontSize: Size.regular,
        lineHeight: Size.regular * Height.lineHeightMedium,
    },
    regularSemiBold: {
        fontSize: Size.regular,
        lineHeight: Size.regular * Height.lineHeightNormal,
    },
    default: {
        fontSize: Size.medium,
        lineHeight: Size.medium * Height.lineHeightNormal,
    },
    defaultSemiBold: {
        fontSize: Size.medium,
        lineHeight: Size.medium * Height.lineHeightMedium,
    },
    highlight: {
        fontSize: Size.giant,
        lineHeight: Size.giant * Height.lineHeightNormal,
    },
    large: {
        fontSize: Size.xlarge,
        lineHeight: Size.xlarge * Height.lineHeightNormal,
    },
    jumbo: {
        fontSize: Size.jumbo,
        lineHeight: Size.jumbo * Height.lineHeightNormal,
    },
    subtitle: {
        fontSize: Size.large,
    },
    link: {
        lineHeight: 30,
        fontSize: Size.medium,
        color: '#FFFFFF',
    },
    small: {
        fontSize: Size.small,
        lineHeight: Size.small * Height.lineHeightNormal,
    },
});