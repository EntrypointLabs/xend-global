import React from 'react';
import { View, Text, SectionList, TouchableOpacity, Image } from 'react-native';
import { ScreenLayout } from '@/components/ui/layout';
import { ThemedText } from '@/components/ui/atoms';
import { SettingsItem } from '@/components/ui/molecules';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColor } from '@/hooks/useThemeColor';
import { Spacing } from '@/constants/Spacing';
import { useAuth } from '@/contexts/AuthContext';
import TabHeaderText from '@/components/ui/atoms/TabHeaderText';

export default function SettingsScreen() {
    const { logout } = useAuth();
    const textColor = useThemeColor({}, 'text');
    const backgroundColor = useThemeColor({}, 'background');

    const sections = [
        {
            title: 'Security',
            data: [
                {
                    label: 'Keys and Recovery',
                    icon: <Ionicons name="key-outline" size={22} color="#AF52DE" />, // Purple
                    onPress: () => { },
                },
                {
                    label: 'Spending Limit',
                    icon: <Ionicons name="speedometer-outline" size={22} color="#007AFF" />, // Blue
                    onPress: () => { },
                },
            ]
        },
        {
            title: 'General',
            data: [
                {
                    label: 'Edit Wallet',
                    icon: <Ionicons name="wallet-outline" size={22} color={textColor} />,
                    onPress: () => { },
                },
                {
                    label: 'Notifications',
                    icon: <Ionicons name="notifications-outline" size={22} color="#007AFF" />,
                    onPress: () => { },
                },
                {
                    label: 'Address Book',
                    icon: <Ionicons name="person-circle-outline" size={22} color="#007AFF" />,
                    onPress: () => { },
                },
                {
                    label: 'NFTs',
                    icon: <Ionicons name="images-outline" size={22} color="#007AFF" />,
                    onPress: () => { },
                },
            ]
        },
        {
            title: 'About',
            data: [
                {
                    label: 'Contact Support',
                    icon: <Ionicons name="chatbubble-ellipses-outline" size={22} color="#FF2D55" />, // Pink
                    onPress: () => { },
                },
                {
                    label: 'Share your Feedback',
                    icon: <Ionicons name="chatbox-outline" size={22} color="#34C759" />, // Green
                    onPress: () => { },
                },
                {
                    label: 'Follow @fusewallet',
                    icon: <Ionicons name="logo-twitter" size={22} color="#007AFF" />, // Blue
                    onPress: () => { },
                },
            ]
        }
    ];

    return (
        <ScreenLayout>
            <View className="flex-1 w-full">
                <View className="mb-6">
                    <TabHeaderText>Settings</TabHeaderText>
                </View>

                {/* Fuse Plus Banner */}
                <TouchableOpacity
                    className="mb-8 bg-black rounded-3xl p-4 flex-row items-center justify-between"
                    activeOpacity={0.9}
                >
                    <View className="flex-row items-center">
                        <View className="w-8 h-8 mr-3 items-center justify-center">
                            <Ionicons name="sparkles" size={20} color="white" />
                        </View>
                        <View>
                            <Text className="text-white font-bold text-sm">Get Fuse Plus</Text>
                            <Text className="text-gray-400 text-xs">Earn more, pay less</Text>
                        </View>
                    </View>
                    <View className="w-6 h-6 rounded-full bg-white/20 items-center justify-center">
                        <Ionicons name="chevron-forward" size={14} color="white" />
                    </View>
                </TouchableOpacity>

                <SectionList
                    sections={sections}
                    keyExtractor={(item, index) => item.label + index}
                    renderItem={({ item, index, section }) => (
                        <View className="">
                            <SettingsItem
                                label={item.label}
                                icon={item.icon}
                                onPress={item.onPress}
                                isLast={index === section.data.length - 1}
                            />
                        </View>
                    )}
                    renderSectionHeader={({ section: { title } }) => (
                        <View className="mt-6 mb-2">
                            <Text className="text-lg font-medium text-gray-500">{title}</Text>
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