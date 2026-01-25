import React, { useState } from 'react';
import { StyleSheet, View, Image, TouchableOpacity, Switch } from 'react-native';
import { ThemedText } from '@/components/ui/atoms';
import { ActionModal } from '../ActionModal';
import { ActivityItemProps } from '../ActivityItem';
import { Spacing } from '@/constants/Spacing';
import { useThemeColor } from '@/hooks/useThemeColor';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Haptic from 'expo-haptics';

interface TransactionDetailModalProps {
    visible: boolean;
    onClose: () => void;
    item: ActivityItemProps | null;
}

export function TransactionDetailModal({ visible, onClose, item }: TransactionDetailModalProps) {
    const textColor = useThemeColor({}, 'text');
    const subtitleColor = useThemeColor({}, 'tabIconDefault');
    const backgroundColor = useThemeColor({}, 'background');
    const [hideWallet, setHideWallet] = useState(true);

    if (!item) return null;

    const copyToClipboard = async (text: string) => {
        await Clipboard.setStringAsync(text);
        Haptic.notificationAsync(Haptic.NotificationFeedbackType.Success);
    };

    return (
        <ActionModal visible={visible} onClose={onClose}>
            <View style={styles.container}>
                {/* Icon & Status Badge */}
                <View style={styles.iconContainer}>
                    <Image source={item.icon} style={styles.icon} />
                    <View style={styles.statusBadge}>
                        <Ionicons name="checkmark-circle" size={16} color="#34C759" />
                    </View>
                </View>

                {/* Subtitle (Type) */}
                <ThemedText style={{ color: subtitleColor, marginBottom: 4 }}>
                    {item.subtitle}
                </ThemedText>

                {/* Amount */}
                <ThemedText type="title" style={styles.amount}>
                    {item.value}
                </ThemedText>

                {/* Date */}
                <ThemedText style={{ color: subtitleColor, fontSize: 13, marginBottom: Spacing.xl }}>
                    {item.date || 'Jan 4, 2026 at 12:31 AM'}
                </ThemedText>

                {/* Details Section */}
                <View style={styles.detailsContainer}>
                    {/* Status Row */}
                    <View style={styles.row}>
                        <ThemedText type="defaultSemiBold">Status</ThemedText>
                        <View style={styles.valueRow}>
                            <ThemedText style={{ color: '#34C759', marginRight: 4 }}>Completed</ThemedText>
                            <Ionicons name="checkmark-circle" size={14} color="#34C759" />
                        </View>
                    </View>

                    <View style={[styles.separator, { backgroundColor: subtitleColor, opacity: 0.1 }]} />

                    {/* From Row */}
                    <View style={styles.row}>
                        <ThemedText style={{ color: subtitleColor }}>From</ThemedText>
                        <TouchableOpacity style={styles.valueRow} onPress={() => copyToClipboard('CZ2R...K4Aj')}>
                            <ThemedText type="defaultSemiBold" style={{ marginRight: 4 }}>CZ2R...K4Aj</ThemedText>
                            <Ionicons name="copy-outline" size={14} color={subtitleColor} />
                        </TouchableOpacity>
                    </View>

                    <View style={[styles.separator, { backgroundColor: subtitleColor, opacity: 0.1 }]} />

                    {/* Transaction Hash */}
                    <View style={styles.row}>
                        <ThemedText style={{ color: subtitleColor }}>Onchain transaction</ThemedText>
                        <TouchableOpacity style={styles.valueRow} onPress={() => copyToClipboard('2to3...GBhp')}>
                            <ThemedText type="defaultSemiBold" style={{ marginRight: 4 }}>2to3...GBhp</ThemedText>
                            <Ionicons name="copy-outline" size={14} color={subtitleColor} />
                        </TouchableOpacity>
                    </View>

                    <View style={[styles.separator, { backgroundColor: subtitleColor, opacity: 0.1 }]} />

                    {/* Fees */}
                    <View style={styles.row}>
                        <ThemedText style={{ color: subtitleColor }}>Onchain fees</ThemedText>
                        <View style={styles.valueRow}>
                            <ThemedText style={{ color: subtitleColor, marginRight: 4, fontSize: 13 }}>Fuse⁺</ThemedText>
                            <ThemedText style={{ color: '#34C759' }}>Covered</ThemedText>
                        </View>
                    </View>

                    <View style={[styles.separator, { backgroundColor: subtitleColor, opacity: 0.1 }]} />

                    {/* Hide Wallet Toggle */}
                    <View style={styles.row}>
                        <View style={styles.valueRow}>
                            <ThemedText style={{ color: subtitleColor, marginRight: 6 }}>Hide My Wallet</ThemedText>
                            <Ionicons name="eye-off-outline" size={14} color={subtitleColor} />
                        </View>
                        <ThemedText type="defaultSemiBold">Enabled</ThemedText>
                    </View>
                </View>
            </View>
        </ActionModal>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        paddingVertical: Spacing.md,
    },
    iconContainer: {
        position: 'relative',
        marginBottom: Spacing.md,
    },
    icon: {
        width: 64,
        height: 64,
        borderRadius: 32,
    },
    statusBadge: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        backgroundColor: 'white',
        borderRadius: 10,
        overflow: 'hidden',
    },
    amount: {
        fontSize: 32,
        fontWeight: 'bold',
        marginBottom: Spacing.xs,
        textAlign: 'center',
    },
    detailsContainer: {
        width: '100%',
        backgroundColor: 'rgba(0,0,0,0.03)', // Subtle background for the card
        borderRadius: 16,
        padding: Spacing.md,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: Spacing.sm,
    },
    valueRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    separator: {
        height: 1,
        width: '100%',
        marginVertical: 4,
    },
});
