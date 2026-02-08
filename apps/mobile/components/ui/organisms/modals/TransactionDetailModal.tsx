import React, { useState } from 'react';
import { StyleSheet, View, Image, TouchableOpacity, Switch, ImageSourcePropType } from 'react-native';
import { ThemedText } from '@/components/ui/atoms';
import { ActionModal } from '../ActionModal';
import { ActivityItemProps } from '../ActivityItem';
import { Spacing } from '@/constants/Spacing';
import { useThemeColor } from '@/hooks/useThemeColor';
import { FontAwesome6, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Haptic from 'expo-haptics';
import { formatAmount } from '@/utils/solana';
import { truncateAddress } from '@/utils/helper';
import { Typography } from '../../atoms/Typography';
import { format } from 'date-fns';
import HapticPressable from '../../atoms/HapticPressable';

interface TransactionDetailModalProps {
    visible: boolean;
    onClose: () => void;
    item: ActivityItemProps | null;
}

export function TransactionDetailModal({ visible, onClose, item }: TransactionDetailModalProps) {
    const copyIconColor = "rgba(0,0,0,0.3)"

    if (!item) return null;

    const copyToClipboard = async (text: string) => {
        await Clipboard.setStringAsync(text);
        Haptic.notificationAsync(Haptic.NotificationFeedbackType.Success);
    };


    const transactionType = item.side === "send" ? "Sent" : "Received";
    const amount = formatAmount(item.amount, item.token.decimal);
    const date = format(new Date(item.date), "MMM d, yyyy 'at' h:mma");

    const rowClass = "flex-row justify-between items-center py-2"
    return (
        <ActionModal visible={visible} onClose={onClose}>
            <View className='items-center'>

                <HapticPressable onPress={onClose} className='absolute -top-4 -right-4 p-4'>
                    <FontAwesome6 name="xmark" size={20} color={copyIconColor} />
                </HapticPressable>

                <View style={styles.iconContainer}>
                    <Image source={item.token.icon as ImageSourcePropType} style={styles.icon} />
                    <View className='absolute top-0 right-0 bg-white rounded-full overflow-hidden'>
                        <Ionicons name="checkmark-circle" size={16} color="#34C759" />
                    </View>
                </View>


                <Typography weight="600" className='text-black/30 text-sm mb-1'>
                    {transactionType}
                </Typography>


                <Typography weight="700" className='text-3xl mb-1'>
                    {amount} {item.token.symbol}
                </Typography>


                <Typography weight="600" className='text-black/30 text-sm mb-4'>
                    {date}
                </Typography>


                <View className='w-full pb-3'>
                    <View className={rowClass}>
                        <Typography weight="600">Status</Typography>
                        <View style={styles.valueRow}>
                            <Typography style={{ color: '#34C759', marginRight: 4 }}>Completed</Typography>
                            <Ionicons name="checkmark-circle" size={14} color="#34C759" />
                        </View>
                    </View>



                    <View className={rowClass}>
                        <Typography weight="600" className='text-black/30'>From</Typography>
                        <TouchableOpacity style={styles.valueRow} onPress={() => copyToClipboard('CZ2R...K4Aj')}>
                            <Typography weight="600" style={{ marginRight: 4 }}>CZ2R...K4Aj</Typography>
                            <Ionicons name="copy-outline" size={14} color={copyIconColor} />
                        </TouchableOpacity>
                    </View>

                    <View className={rowClass}>
                        <Typography weight="600" className='text-black/30'>Onchain transaction</Typography>
                        <TouchableOpacity style={styles.valueRow} onPress={() => copyToClipboard(item.transactionHash)}>
                            <Typography weight="600" style={{ marginRight: 4 }}>{truncateAddress(item.transactionHash)}</Typography>
                            <Ionicons name="copy-outline" size={14} color={copyIconColor} />
                        </TouchableOpacity>
                    </View>



                    <View className={rowClass}>
                        <Typography weight="600" className='text-black/30'>Onchain fees</Typography>
                        <View style={styles.valueRow}>
                            <Typography weight="500" className='text-black/30' style={{ marginRight: 4, fontSize: 13 }}>Fuse⁺</Typography>
                            <Typography weight='500' style={{ color: '#34C759' }}>Covered</Typography>
                        </View>
                    </View>



                    {item.incognito &&
                        <View className={rowClass}>
                            <View className='flex-row items-center gap-1'>
                                <Typography weight="600" className='text-black/30'>Hide My Wallet</Typography>
                                <MaterialCommunityIcons name="shield-half-full" size={13} color="rgba(0,0,0,0.3)" />
                            </View>
                            <Typography weight="600">Enabled</Typography>
                        </View>}
                </View>
            </View>
        </ActionModal>
    );
}

const styles = StyleSheet.create({
    iconContainer: {
        position: 'relative',
        marginBottom: Spacing.md,
    },
    icon: {
        width: 64,
        height: 64,
        borderRadius: 32,
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
