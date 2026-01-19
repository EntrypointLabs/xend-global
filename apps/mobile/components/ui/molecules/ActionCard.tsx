import React from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ui/atoms';
import { Spacing } from '@/constants/Spacing';
import { useThemeColor } from '@/hooks/useThemeColor';

interface ActionCardProps {
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    iconColor?: string;
    iconBackgroundColor?: string;
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - (Spacing.md * 3)) / 2; // 2 columns with outer padding and gap

export function ActionCard({
    title,
    subtitle,
    icon,
    onPress,
    iconColor = 'white',
    iconBackgroundColor
}: ActionCardProps) {
    const cardBackgroundColor = useThemeColor({}, 'card');
    const primaryColor = useThemeColor({}, 'primary');

    return (
        <TouchableOpacity
            style={[styles.container, { backgroundColor: cardBackgroundColor }]}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <View style={[
                styles.iconContainer,
                { backgroundColor: iconBackgroundColor || primaryColor }
            ]}>
                <Ionicons name={icon} size={24} color={iconColor} />
            </View>

            <View style={styles.textContainer}>
                <ThemedText type="defaultSemiBold" style={styles.title}>{title}</ThemedText>
                <ThemedText type="small" style={styles.subtitle}>{subtitle}</ThemedText>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        width: CARD_WIDTH,
        padding: Spacing.md,
        borderRadius: 24, // High border radius as per design
        marginBottom: Spacing.md,
        minHeight: 140,
        justifyContent: 'space-between',
        // Shadow for depth
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.05,
        shadowRadius: 3.84,
        elevation: 2,
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: Spacing.md,
    },
    textContainer: {
        gap: 4,
    },
    title: {
        fontSize: 16,
    },
    subtitle: {
        opacity: 0.6,
        fontSize: 13,
    }
});
