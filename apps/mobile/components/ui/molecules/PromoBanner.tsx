import React, { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ui/atoms';
import { Spacing } from '@/constants/Spacing';
import { useThemeColor } from '@/hooks/useThemeColor';

interface PromoBannerProps {
    title: string;
    description: string;
    onPress?: () => void;
    onClose?: () => void;
    visible?: boolean;
}

export function PromoBanner({
    title,
    description,
    onPress,
    onClose,
    visible = true
}: PromoBannerProps) {
    const cardBackgroundColor = 'white'; // Design seems to use white/bright bg with shadow
    const buttonColor = useThemeColor({}, 'text');

    if (!visible) return null;

    return (
        <TouchableOpacity
            style={[styles.container, { backgroundColor: cardBackgroundColor }]}
            onPress={onPress}
            activeOpacity={0.9}
        >
            <View style={styles.content}>
                <View style={styles.iconContainer}>
                    <Ionicons name="home" size={20} color="white" />
                </View>
                <View style={styles.textContainer}>
                    <ThemedText type="defaultSemiBold" style={styles.title}>{title}</ThemedText>
                    <ThemedText type="small" style={styles.description}>{description}</ThemedText>
                </View>
            </View>

            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={16} color={buttonColor} style={{ opacity: 0.4 }} />
            </TouchableOpacity>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        padding: Spacing.md,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 'auto', // Push to bottom if in flex container
        marginBottom: Spacing.md,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 3,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#007AFF', // Example blue
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: Spacing.md,
    },
    textContainer: {
        flex: 1,
        gap: 2,
    },
    title: {
        fontSize: 15,
        color: '#000',
    },
    description: {
        opacity: 0.5,
        color: '#000',
    }
});
