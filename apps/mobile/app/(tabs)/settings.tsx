import React from 'react';
import { View, SectionList, TouchableOpacity, Image } from 'react-native';
import { Typography } from '@/components/ui/atoms/Typography';
import { ScreenLayout } from '@/components/ui/layout';
import { ThemedText } from '@/components/ui/atoms';
import { SettingsItem } from '@/components/ui/molecules';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColor } from '@/hooks/useThemeColor';
import { Spacing } from '@/constants/Spacing';
import { useAuth } from '@/contexts/AuthContext';
import TabHeaderText from '@/components/ui/atoms/TabHeaderText';
import clsx from 'clsx';

export default function SettingsScreen() {
    const { logout } = useAuth();
    const textColor = useThemeColor({}, 'text');
    const backgroundColor = useThemeColor({}, 'background');

    const sections = [
        {
            title: 'Security',
            data: [
                {
                    label: 'Keys & Recovery',
                    icon: require('@/assets/icons/keys.png'),
                    onPress: () => { },
                },
                {
                    label: 'Spending Limits',
                    icon: require('@/assets/icons/spending-limt.png'),
                    onPress: () => { },
                },
            ]
        },
        {
            title: 'General',
            data: [
                {
                    label: 'Edit wallet',
                    icon: require('@/assets/icons/edit-wallet.png'),
                    onPress: () => { },
                },
                {
                    label: 'Notifications',
                    icon: require('@/assets/icons/notification.png'),
                    onPress: () => { },
                },
                {
                    label: 'Address book',
                    icon: require('@/assets/icons/address-book.png'),
                    onPress: () => { },
                },
                {
                    label: 'NFTs',
                    icon: require('@/assets/icons/nfts.png'),
                    onPress: () => { },
                },
            ]
        },
        {
            title: 'About',
            data: [
                {
                    label: 'Contact support',
                    icon: require('@/assets/icons/support.png'),
                    onPress: () => { },
                },
                {
                    label: 'Share your feedback',
                    icon: require('@/assets/icons/feedback.png'),
                    onPress: () => { },
                },
                {
                    label: 'Follow @fusewallet',
                    // icon: <Ionicons name="logo-twitter" size={22} color="#007AFF" />, // Blue
                    icon: require('@/assets/icons/x.png'),
                    onPress: () => { },
                },
                {
                    label: 'Delete Wallet',
                    icon: require('@/assets/icons/x.png'),
                    onPress: () => { },
                    color: "#F90101"
                },
            ]
        }
    ];

    return (
        <ScreenLayout>
            <View className="flex-1 w-full">
                <SectionList
                    ListHeaderComponent={
                        <View>
                            <View className="mb-6">
                                <TabHeaderText>Settings</TabHeaderText>
                            </View>

                            {/* Fuse Plus Banner */}
                            <TouchableOpacity
                                className="bg-black rounded-3xl p-4 flex-row items-center justify-between"
                                activeOpacity={0.9}
                            >
                                <View className="flex-row items-center">
                                    <View className="w-8 h-8 mr-3 items-center justify-center">
                                        <Ionicons name="sparkles" size={20} color="white" />
                                    </View>
                                    <View>
                                        <Typography weight="700" className="text-white text-sm">Get Fuse Plus</Typography>
                                        <Typography className="text-gray-400 text-xs">Earn more, pay less</Typography>
                                    </View>
                                </View>
                                <View className="w-6 h-6 rounded-full bg-white/20 items-center justify-center">
                                    <Ionicons name="chevron-forward" size={14} color="white" />
                                </View>
                            </TouchableOpacity>
                        </View>
                    }
                    sections={sections}
                    keyExtractor={(item, index) => item.label + index}
                    renderItem={({ item }) => (
                        <SettingsItem
                            label={item.label}
                            icon={item.icon}
                            onPress={item.onPress}
                            color={item.color}
                        />

                    )}
                    renderSectionHeader={({ section: { title } }) => (
                        <View className="mb-2 mt-6">
                            <Typography weight="500" className="text-lg text-black/30">{title}</Typography>
                        </View>
                    )}
                    stickySectionHeadersEnabled={false}
                    contentContainerStyle={{ paddingBottom: Spacing.xxxl }}
                    showsVerticalScrollIndicator={false}
                />
            </View>
        </ScreenLayout>
    );
}