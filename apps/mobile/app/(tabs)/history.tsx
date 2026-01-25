import React, { useState } from 'react';
import { View } from 'react-native';
import { ScreenLayout } from '@/components/ui/layout';
import { ActivityList, ActivitySection, ActivityItemProps, TransactionDetailModal } from '@/components/ui/organisms';
import { ThemedText } from '@/components/ui/atoms';

// Mock Assets
const ICONS = {
    usdc: require('@/assets/icons/usdc.png'),
    solana: require('@/assets/icons/wallet.png'),
    earn: require('@/assets/icons/earn.png'),
    swap: require('@/assets/icons/redo.png'),
    key: require('@/assets/icons/card.png'),
};

const MOCK_DATA: ActivitySection[] = [
    {
        title: 'Oct 3, 2025',
        data: [
            {
                title: 'USDC',
                subtitle: 'To: HTjz...sUjs',
                value: '-100 USDC',
                amount: '100.00',
                icon: ICONS.usdc,
                isPositive: false,
                date: 'Oct 3, 2025 at 10:30 AM',
            },
            {
                title: 'USDC',
                subtitle: 'To: HTjz...sUjs',
                value: '-45 USDC',
                amount: '45.00',
                icon: ICONS.usdc,
                isPositive: false,
                date: 'Oct 3, 2025 at 9:15 AM',
            },
            {
                title: 'USDC',
                subtitle: 'From: CZ2R...K4Aj',
                value: '+154.03 USDC',
                amount: '154.03',
                icon: ICONS.usdc,
                isPositive: true,
                date: 'Oct 3, 2025 at 8:45 AM',
            },
            {
                title: 'Card Deposit',
                subtitle: 'Visa ··· 7649',
                value: '-400 USDC',
                amount: '400.00',
                icon: ICONS.key, // Using card icon
                isPositive: false,
                date: 'Oct 3, 2025 at 8:00 AM',
            },
            {
                title: 'Card activated',
                subtitle: 'Visa ··· 7649',
                value: '',
                amount: '',
                icon: ICONS.key,
                isPositive: true,
                isHidden: true, // Just to test hidden logic if needed, but per design this has no value
                date: 'Oct 3, 2025 at 7:55 AM',
            },
            {
                title: 'Verification Successful',
                subtitle: 'Bridge has verified your identity',
                value: '',
                amount: '',
                icon: ICONS.key, // Using placeholder
                isPositive: true,
                date: 'Oct 3, 2025 at 7:50 AM',
            },
        ],
    },
    {
        title: 'Sep 28, 2025',
        data: [
            {
                title: 'Kamino Earn',
                subtitle: 'Withdraw',
                value: '*****',
                amount: '*****',
                icon: ICONS.earn,
                isHidden: true,
                date: 'Sep 28, 2025 at 2:00 PM',
            },
        ]
    },
    {
        title: 'Oct 3, 2025',
        data: [
            {
                title: 'USDC',
                subtitle: 'To: HTjz...sUjs',
                value: '-100 USDC',
                amount: '100.00',
                icon: ICONS.usdc,
                isPositive: false,
                date: 'Oct 3, 2025 at 10:30 AM',
            },
            {
                title: 'USDC',
                subtitle: 'To: HTjz...sUjs',
                value: '-45 USDC',
                amount: '45.00',
                icon: ICONS.usdc,
                isPositive: false,
                date: 'Oct 3, 2025 at 9:15 AM',
            },
            {
                title: 'USDC',
                subtitle: 'From: CZ2R...K4Aj',
                value: '+154.03 USDC',
                amount: '154.03',
                icon: ICONS.usdc,
                isPositive: true,
                date: 'Oct 3, 2025 at 8:45 AM',
            },
            {
                title: 'Card Deposit',
                subtitle: 'Visa ··· 7649',
                value: '-400 USDC',
                amount: '400.00',
                icon: ICONS.key, // Using card icon
                isPositive: false,
                date: 'Oct 3, 2025 at 8:00 AM',
            },
            {
                title: 'Card activated',
                subtitle: 'Visa ··· 7649',
                value: '',
                amount: '',
                icon: ICONS.key,
                isPositive: true,
                isHidden: true, // Just to test hidden logic if needed, but per design this has no value
                date: 'Oct 3, 2025 at 7:55 AM',
            },
            {
                title: 'Verification Successful',
                subtitle: 'Bridge has verified your identity',
                value: '',
                amount: '',
                icon: ICONS.key, // Using placeholder
                isPositive: true,
                date: 'Oct 3, 2025 at 7:50 AM',
            },
        ],
    },
    {
        title: 'Sep 28, 2025',
        data: [
            {
                title: 'Kamino Earn',
                subtitle: 'Withdraw',
                value: '*****',
                amount: '*****',
                icon: ICONS.earn,
                isHidden: true,
                date: 'Sep 28, 2025 at 2:00 PM',
            },
        ]
    },
];

export default function HistoryScreen() {
    const [selectedItem, setSelectedItem] = useState<ActivityItemProps | null>(null);
    const [modalVisible, setModalVisible] = useState(false);

    // Handler for item press
    const handleItemPress = (item: ActivityItemProps) => {
        setSelectedItem(item);
        setModalVisible(true);
    };

    // Enhance data with onPress handlers
    const sectionsWithHandlers = MOCK_DATA.map(section => ({
        ...section,
        data: section.data.map(item => ({
            ...item,
            onPress: () => handleItemPress(item),
        })),
    }));

    return (
        <ScreenLayout>
            <View>
                <ThemedText type="subtitle">Activity</ThemedText>
            </View>
            <ActivityList sections={sectionsWithHandlers} />

            <TransactionDetailModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                item={selectedItem}
            />
        </ScreenLayout>
    );
}
