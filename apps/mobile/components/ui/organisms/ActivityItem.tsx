import React from 'react';
import { StyleSheet, View, ImageSourcePropType, Image, TouchableOpacity } from 'react-native';
import { ThemedText } from '@/components/ui/atoms';
import { Spacing } from '@/constants/Spacing';
import { useThemeColor } from '@/hooks/useThemeColor';

export interface ActivityItemProps {
    title: string;
    subtitle: string;
    value: string;
    isPositive?: boolean;
    isHidden?: boolean;
    icon: ImageSourcePropType;
    onPress?: () => void;
    // Extra data for modal
    date?: string;
    status?: string;
    [key: string]: any;
}

export function ActivityItem({ title, subtitle, value, isPositive, isHidden, icon, onPress }: ActivityItemProps) {
    const textColor = useThemeColor({}, 'text');
    const subtitleColor = useThemeColor({}, 'tabIconDefault');
    const positiveColor = '#34C759'; // Green
    const negativeColor = '#FF3B30'; // Red

    const displayValue = isHidden ? '****' : value;
    const valueColor = isHidden ? subtitleColor : (isPositive ? positiveColor : negativeColor);

    return (
        <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
            <Image source={icon} style={styles.icon} />
            <View style={styles.content}>
                <View style={styles.textContainer}>
                    <ThemedText type="defaultSemiBold" style={styles.title}>{title}</ThemedText>
                    <ThemedText type="tiny" style={[styles.subtitle, { color: subtitleColor }]}>{subtitle}</ThemedText>
                </View>
                <ThemedText
                    type="defaultSemiBold"
                    style={[styles.value, { color: valueColor }]}
                >
                    {displayValue}
                </ThemedText>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.md,
    },
    icon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: Spacing.md,
    },
    content: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    textContainer: {
        flexDirection: 'column',
    },
    title: {
        marginBottom: 2,
    },
    subtitle: {
        fontSize: 13,
    },
    value: {
        fontSize: 13,
        letterSpacing: 0.5,
    },
});
