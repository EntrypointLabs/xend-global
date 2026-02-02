import React, { useMemo, useState, useRef } from 'react';
import { View, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Typography } from '@/components/ui/atoms/Typography';
import { useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/layout';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColor } from '@/hooks/useThemeColor';
import HapticPressable from '@/components/ui/atoms/HapticPressable';
import TabHeaderText from '@/components/ui/atoms/TabHeaderText';
import { ActionPill } from '@/components/ui/molecules';
import { SendModal } from '@/components/ui/organisms/modals/SendModal';
import { ReceiveModal } from '@/components/ui/organisms/modals/ReceiveModal';
import { QRCodeModal } from '@/components/ui/organisms/modals/QRCodeModal';
import { SendFlowModal } from '@/components/ui/organisms/send/SendFlowModal';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useAuth } from '@/contexts/AuthContext';
import { useModalFlow } from '@/contexts/ModalFlowContext';

export default function CashScreen() {
    const router = useRouter();
    const backgroundColor = useThemeColor({}, 'background');
    const { user } = useAuth();
    const { hideAllModals } = useModalFlow();

    // Modal State
    const [isSendModalVisible, setIsSendModalVisible] = useState(false);
    const [isReceiveModalVisible, setIsReceiveModalVisible] = useState(false);
    const [isQRCodeModalVisible, setIsQRCodeModalVisible] = useState(false);
    const sendFlowModalRef = useRef<BottomSheetModal>(null);

    const actionItems = useMemo(() => [
        {
            icon: ({ isActive }: { isActive?: boolean }) => (
                <View className="flex-row items-center gap-2">
                    <View className="bg-black rounded-full w-6 h-6 items-center justify-center">
                        <Ionicons name="arrow-down" size={14} color="white" />
                    </View>
                    <Typography weight="700" className="text-lg">Receive</Typography>
                </View>
            ),
            onPress: () => setIsReceiveModalVisible(true),
            label: 'Receive',
        },
        {
            icon: ({ isActive }: { isActive?: boolean }) => (
                <View className="flex-row items-center gap-2">
                    <Ionicons name="paper-plane-outline" size={20} color="black" />
                    <Typography weight="700" className="text-lg">Send</Typography>
                </View>
            ),
            onPress: () => setIsSendModalVisible(true),
            label: 'Send',
        }
    ], []);

    return (
        <ScreenLayout>
            <View className="flex-1 w-full relative">
                {/* Header */}
                <View className="flex-row items-center mb-6">
                    <Image
                        source={require('@/assets/icons/usdc.png')}
                        className="size-9 mr-2.5"
                        resizeMode="contain"
                    />
                    <TabHeaderText>Cash</TabHeaderText>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
                    {/* Balance */}
                    <View className="mb-8">
                        <Typography weight="500" className="text-black/30 text-base mb-1">Balance</Typography>
                        <View className="flex-row items-baseline">
                            <Typography weight="700" variant='h2'>$4.</Typography>
                            <Typography weight="700" variant='h2' className="text-black/30">66</Typography>
                        </View>
                    </View>

                    {/* USDC Card */}
                    <View className="bg-white rounded-[24px] p-5 border border-[#A3A3A3]/20 mb-8">
                        <View className="flex-row justify-between items-start mb-4">
                            <Image
                                source={require('@/assets/icons/usdc.png')}
                                className="w-10 h-10"
                                resizeMode="contain"
                            />
                        </View>

                        <View className="flex-row justify-between items-end mb-4">
                            <View>
                                <Typography weight="700" className="text-lg mb-1">USDC</Typography>
                                <Typography weight="600" className="text-black/30">4.6568 USDC</Typography>
                            </View>
                            <Typography weight="600" className="text-lg">$4.<Typography weight="600" className="text-black/30">66</Typography></Typography>
                        </View>

                        {/* Divider */}
                        <View className="h-px bg-gray-100 w-full my-2 border-t border-dashed border-gray-200" style={{}} />

                        {/* Earn Footer */}
                        <TouchableOpacity className="flex-row justify-between items-center pt-2">
                            <View className="flex-row items-center">
                                <View className="w-5 h-5 bg-blue-500 rounded-full mr-2 items-center justify-center">
                                    <Ionicons name="trending-up" size={12} color="white" />
                                </View>
                                <Typography weight="500">Earn <Typography weight="500" className="text-blue-500">7.57% </Typography><Typography weight="500">APY</Typography></Typography>
                            </View>
                            <View className="flex-row items-center">
                                <Typography weight="500" className="text-black/30 text-sm mr-1">Put USDC into Earn</Typography>
                                <Ionicons name="chevron-forward" size={12} color="#999" />
                            </View>
                        </TouchableOpacity>
                    </View>

                    {/* Other Assets - Empty State */}
                    <View>
                        <Typography weight="500" className="mb-4">Other assets</Typography>
                        <View className="flex-row items-center">
                            <View className="size-10 rounded-full border-2 border-dashed border-black/40 mr-2" />
                            <View>
                                <Typography weight="500" className="text-black/30 text-sm">You have no other</Typography>
                                <Typography weight="500" className="text-black/30 text-sm">cash assets yet</Typography>
                            </View>
                        </View>
                    </View>
                </ScrollView>

                {/* Bottom Actions */}
                <View className="absolute bottom-0 left-0 right-0 flex-row justify-between items-center bg-transparent">
                    {/* Back Button */}
                    <HapticPressable
                        className="w-14 h-14 bg-white rounded-full items-center justify-center shadow-sm"
                        onPress={() => router.back()}
                    >
                        <Ionicons name="chevron-back" size={24} color="black" />
                    </HapticPressable>

                    {/* Action Pill */}
                    <ActionPill
                        items={actionItems}

                    />
                </View>
            </View>

            {/* Modals */}
            <SendModal
                visible={isSendModalVisible}
                onClose={() => setIsSendModalVisible(false)}
                onSendToWallet={() => {
                    setIsSendModalVisible(false);
                    // Short delay to allow animation to start closing before opening new one
                    // or just open it. ActionModal handles mounting.
                    setTimeout(() => sendFlowModalRef.current?.present(), 100);
                }}
            />

            <SendFlowModal
                ref={sendFlowModalRef}
                onClose={() => { }}
            />

            <ReceiveModal
                visible={isReceiveModalVisible}
                onClose={() => {
                    setIsReceiveModalVisible(false);
                    hideAllModals(); // Ensure flow context is cleared if needed
                }}
                onOpenQRCode={() => setIsQRCodeModalVisible(true)}
            />

            <QRCodeModal
                visible={isQRCodeModalVisible}
                onClose={() => setIsQRCodeModalVisible(false)}
                walletAddress={user?.address || 'sjsksjknkjs'}
            />
        </ScreenLayout>
    );
}
