import { StyleSheet, View, ScrollView, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ThemedText } from '@/components/ui/atoms';
import { Spacing } from '@/constants/Spacing';
import { ActionCard, PromoBanner } from '@/components/ui/molecules';
import { ThemedScreen } from '@/components/ui/layout';
import { TransferResponse, Transaction } from '@/types/Transaction';
import { useAuth } from '@/contexts/AuthContext';
import { SendModal } from '@/components/ui/organisms/modals/SendModal';
import { ReceiveModal } from '@/components/ui/organisms/modals/ReceiveModal';
import { QRCodeModal } from '@/components/ui/organisms/modals/QRCodeModal';
import { useModalFlow } from '@/contexts/ModalFlowContext';
import { ComingSoonToast } from '@/components/ui/organisms/ComingSoonToast';
import { useComingSoonToast } from '@/hooks/useComingSoonToast';
import { TransactionList } from '@/components/ui/organisms/TransactionList';
import { useWalletData } from '@/hooks/useWalletData';
import * as Sentry from '@sentry/react-native';
import HapticPressable from '@/components/ui/atoms/HapticPressable';
import { useRouter } from 'expo-router';
import TabHeaderText from '@/components/ui/atoms/TabHeaderText';

function HomeScreenContent() {
    const router = useRouter();
    const { accountInfo, user } = useAuth();
    const { showReceiveModal, isReceiveModalVisible, hideAllModals } = useModalFlow();
    const [isSendModalVisible, setIsSendModalVisible] = useState(false);
    const [isQRCodeModalVisible, setIsQRCodeModalVisible] = useState(false);
    const { isVisible, message, showToast, hideToast } = useComingSoonToast();
    const { balance, transfers, isLoading, error, fetchWalletData } = useWalletData(accountInfo);

    useEffect(() => {
        // if (!accountInfo || !accountInfo.smart_account_signer_public_key) {
        //     logout();
        //     return;
        // }

        const initializeAccount = async () => {
            try {
                // const account = await createSmartAccount(accountInfo);
                // await StorageService.setItem(AUTH_STORAGE_KEYS.GRID_USER_ID, account.grid_user_id);
                // await StorageService.setItem(AUTH_STORAGE_KEYS.SMART_ACCOUNT_ADDRESS, account.smart_account_address);

                // // Only create user if they don't exist
                // const existingUser = await MockDatabase.getUser(account.grid_user_id);
                // if (!existingUser) {
                //     await MockDatabase.createUser(account.grid_user_id);
                // }

                // const updatedAccountInfo = {
                //     ...accountInfo,
                //     smart_account_address: account.smart_account_address,
                //     grid_user_id: account.grid_user_id
                // };

                // setAccountInfo(updatedAccountInfo);
                await fetchWalletData();
            } catch (err) {
                console.error('Error initializing account:', err);
                Sentry.captureException(new Error(`Error initializing account: ${err}. (tabs)/index.tsx (initializeAccount)`));
            }
        };

        initializeAccount();
    }, [fetchWalletData]);

    const actions = useMemo(() => [
        {
            title: 'Cash',
            subtitle: 'Send and Receive',
            icon: require('@/assets/icons/usdc.png'),
            onPress: () => router.push('/cash'),
            color: '#007AFF', // Blue
        },
        {
            title: 'Investments',
            subtitle: 'Trade Crypto',
            icon: require('@/assets/icons/investment.png'),
            onPress: () => showToast("Investment features coming soon!"),
            color: '#FF9500', // Orange
        },
        {
            title: 'Earn',
            subtitle: 'Up to 7.99% APY',
            icon: require('@/assets/icons/earn.png'),
            onPress: () => showToast("Earn features coming soon!"),
            color: '#AF52DE', // Purple
        },
        {
            title: 'Fuse Card',
            subtitle: 'Get your free Card',
            icon: require('@/assets/icons/card.png'),
            onPress: () => showToast("Card features coming soon!"),
            color: '#000000', // Black
        }
    ], [showToast]);

    const formatTransfers = useCallback((transfers: TransferResponse) => {
        for (const transfer of transfers) {
            if ('Spl' in transfer && transfer.Spl.confirmation_status === 'confirmed') {
            }
        }
        const transfersToConsider = transfers.filter(transfer => ('Spl' in transfer && transfer.Spl.mint === process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS && ['confirmed'].includes(transfer.Spl.confirmation_status)) || ('Bridge' in transfer && (transfer.Bridge.state === 'payment_processed' || transfer.Bridge.state === 'payment_submitted')));

        const transactions = transfersToConsider.map(transfer => {

            if ('Spl' in transfer) {
                const splTransfer = transfer.Spl;

                return {
                    id: splTransfer.id,
                    amount: parseFloat(splTransfer.ui_amount),
                    status: splTransfer.confirmation_status,
                    type: splTransfer.direction === 'outflow' ? 'sent' as const : 'received' as const,
                    date: new Date(splTransfer.created_at),
                    address: splTransfer.from_address === user?.address
                        ? splTransfer.to_address
                        : splTransfer.from_address
                } as Transaction;
            } else if ('Bridge' in transfer) {
                const type = transfer.Bridge.source.from_address === user?.address ? 'sent' as const : 'received' as const;

                return {
                    id: transfer.Bridge.id,
                    amount: parseFloat(transfer.Bridge.amount),
                    status: transfer.Bridge.state,
                    type: type,
                    date: new Date(transfer.Bridge.created_at),
                    address: type === 'sent' ? transfer.Bridge.destination.external_account_id : user?.address
                } as Transaction;
            } else {
                Sentry.captureException(new Error(`Unknown transfer: ${transfer}. (tabs)/index.tsx (formatTransfers)`));
            }
        });


        // Group transactions by date
        const groups = transactions.reduce((acc: { [key: string]: Transaction[] }, transaction) => {
            if (!transaction) return acc;
            const date = transaction.date;
            const dateStr = date.toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });

            if (!acc[dateStr]) {
                acc[dateStr] = [];
            }
            acc[dateStr].push(transaction);
            return acc;
        }, {});

        // Convert to TransactionGroup array and sort by date
        return Object.entries(groups)
            .map(([title, data]) => ({
                title,
                data: data.sort((a, b) => b.date.getTime() - a.date.getTime())
            }))
            .sort((a, b) => {
                const dateA = new Date(a.data[0].date);
                const dateB = new Date(b.data[0].date);
                return dateB.getTime() - dateA.getTime();
            });
    }, [user?.address]);

    const formattedTransactions = useMemo(() => {
        return formatTransfers(transfers);
    }, [formatTransfers, transfers]);

    return (
        <ThemedScreen useSafeArea={true}>
            <View style={styles.container}>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <View>
                        <TabHeaderText className='mb-8'>Wallet</TabHeaderText>

                        <View>
                            <Text
                                className='text-black/30 font-medium text-sm'
                            >Total Balance <Ionicons name="remove-circle" size={12} color="#999" /> 100%</Text>
                            <Text className='font-bold text-[40px] leading-[140%]'>
                                {`$${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            </Text>
                        </View>

                        {transfers.length === 0 && (
                            <View
                                className='items-center pt-2 pb-6'
                            >
                                <Text className='text-xl font-semibold text-center mb-2'>There is nothing here yet</Text>
                                <Text className='text-center text-black/30 max-w-[250px] mb-7 font-medium text-sm'>
                                    Deposit tokens to your address and start using Fuse Wallet
                                </Text>

                                <HapticPressable
                                    className='bg-black p-2 gap-0.5 items-center rounded-full flex-row'
                                    onPress={showReceiveModal}
                                >
                                    <Ionicons name="arrow-down-circle" size={18} color="white" />
                                    <Text
                                        className='text-white font-medium text-base'
                                    >Receive</Text>
                                </HapticPressable>
                            </View>
                        )}
                    </View>

                    <View
                        className='flex-row flex-wrap justify-between mb-6'
                    >
                        {actions.map((action, index) => (
                            <ActionCard
                                key={index}
                                title={action.title}
                                subtitle={action.subtitle}
                                icon={action.icon}
                                onPress={action.onPress}
                                iconBackgroundColor={action.color}
                            />
                        ))}
                    </View>

                    <PromoBanner
                        title="Get your Virtual Bank Account"
                        description="Receive USD and EUR for USDC"
                        onPress={() => showToast("Virtual Bank Account coming soon!")}
                        onClose={() => { }}
                    />

                    {transfers.length > 0 && (
                        <View style={styles.transactionsContainer}>
                            <ThemedText type="subtitle" style={styles.sectionTitle}>Recent Activity</ThemedText>
                            <TransactionList
                                transactions={formattedTransactions}
                            />
                        </View>
                    )}

                </ScrollView>
                <SendModal
                    visible={isSendModalVisible}
                    onClose={() => setIsSendModalVisible(false)}
                />

                <ReceiveModal
                    visible={isReceiveModalVisible}
                    onClose={hideAllModals}
                    onOpenQRCode={() => setIsQRCodeModalVisible(true)}
                />

                <QRCodeModal
                    visible={isQRCodeModalVisible}
                    onClose={() => setIsQRCodeModalVisible(false)}
                    walletAddress={user?.address || 'ssnksnsmk'}
                />

                <ComingSoonToast
                    visible={isVisible}
                    onHide={hideToast}
                    message={message}
                />

            </View>


        </ThemedScreen>
    );
}

export default function HomeScreen() {
    return <HomeScreenContent />;
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: Spacing.md,
    },
    scrollContent: {
        flexGrow: 1,
        paddingBottom: 100, // Space for bottom tab bar or safe area
    },
    header: {
        marginTop: Spacing.md,
        marginBottom: Spacing.xl,
    },
    emptyStateDescription: {
        textAlign: 'center',
        color: '#8E8E93',
        maxWidth: 250,
        marginBottom: Spacing.lg,
        lineHeight: 20,
    },
    receiveButton: {
        flexDirection: 'row',
        backgroundColor: '#000',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        borderRadius: 20,
        alignItems: 'center',
        gap: 8,
    },
    receiveButtonText: {

    },
    transactionsContainer: {
        marginTop: Spacing.lg,
    },
    sectionTitle: {
        marginBottom: Spacing.md,
    },
});
