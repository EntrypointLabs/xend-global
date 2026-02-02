import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';

type FontWeight = '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' |
    'thin' | 'extralight' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold' | 'black';

export type TypographyProps = TextProps & {
    weight?: FontWeight;
    italic?: boolean;
    children?: React.ReactNode;
};

const fontFamilyMap: Record<FontWeight, string> = {
    '100': 'Inter_100Thin',
    '200': 'Inter_200ExtraLight',
    '300': 'Inter_300Light',
    '400': 'Inter_400Regular',
    '500': 'Inter_500Medium',
    '600': 'Inter_600SemiBold',
    '700': 'Inter_700Bold',
    '800': 'Inter_800ExtraBold',
    '900': 'Inter_900Black',
    'thin': 'Inter_100Thin',
    'extralight': 'Inter_200ExtraLight',
    'light': 'Inter_300Light',
    'regular': 'Inter_400Regular',
    'medium': 'Inter_500Medium',
    'semibold': 'Inter_600SemiBold',
    'bold': 'Inter_700Bold',
    'extrabold': 'Inter_800ExtraBold',
    'black': 'Inter_900Black',
};

const fontFamilyMapItalic: Record<FontWeight, string> = {
    '100': 'Inter_100Thin_Italic',
    '200': 'Inter_200ExtraLight_Italic',
    '300': 'Inter_300Light_Italic',
    '400': 'Inter_400Regular_Italic',
    '500': 'Inter_500Medium_Italic',
    '600': 'Inter_600SemiBold_Italic',
    '700': 'Inter_700Bold_Italic',
    '800': 'Inter_800ExtraBold_Italic',
    '900': 'Inter_900Black_Italic',
    'thin': 'Inter_100Thin_Italic',
    'extralight': 'Inter_200ExtraLight_Italic',
    'light': 'Inter_300Light_Italic',
    'regular': 'Inter_400Regular_Italic',
    'medium': 'Inter_500Medium_Italic',
    'semibold': 'Inter_600SemiBold_Italic',
    'bold': 'Inter_700Bold_Italic',
    'extrabold': 'Inter_800ExtraBold_Italic',
    'black': 'Inter_900Black_Italic',
};

export function Typography({
    children,
    weight = '400',
    italic = false,
    style,
    ...props
}: TypographyProps) {
    const map = italic ? fontFamilyMapItalic : fontFamilyMap;
    const fontFamily = map[weight] || map['400'];

    return (
        <Text
            style={[{ fontFamily }, style]}
            {...props}
        >
            {children}
        </Text>
    );
}
