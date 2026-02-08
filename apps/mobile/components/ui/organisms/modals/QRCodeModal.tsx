import React, { useMemo, useCallback, forwardRef } from 'react';
import { View } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Typography } from '@/components/ui/atoms/Typography';
import HapticPressable from '@/components/ui/atoms/HapticPressable';
import TabHeaderText from '@/components/ui/atoms/TabHeaderText';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useToast } from '@/contexts/ToastContext';

interface QRCodeModalProps {
    walletAddress: string;
}

export const QRCodeModal = forwardRef<BottomSheetModal, QRCodeModalProps>(
    ({ walletAddress }, ref) => {
        const snapPoints = useMemo(() => ['94%'], []);
        const { showToast } = useToast();

        const renderBackdrop = useCallback(
            (props: BottomSheetBackdropProps) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                />
            ),
            []
        );

        const handleCopyAddress = async () => {
            await Clipboard.setStringAsync(walletAddress);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            showToast('Copied address', <Ionicons name="checkmark-circle" size={16} color="black" />);
        };

        const qrCode = useMemo(() => (
            <QRCode
                value={walletAddress}
                size={280}
                color="black"
                backgroundColor="transparent"
                ecl="L"
            />
        ), [walletAddress]);

        return (
            <BottomSheetModal
                ref={ref}
                index={1}
                snapPoints={snapPoints}
                backdropComponent={renderBackdrop}
                enablePanDownToClose
                handleIndicatorStyle={{ display: 'none' }}
                backgroundStyle={{ backgroundColor: '#F0F0F0' }}
                containerStyle={{ zIndex: 1 }}
            >
                <BottomSheetView className="flex-1 h-full bg-[#F0F0F0]">
                    <View className="items-center mb-5 px-4">
                        <TabHeaderText className="text-center">Receive</TabHeaderText>
                        <Typography weight="500" className="text-black/30 text-sm mt-1">
                            Only send Solana assets to this address
                        </Typography>
                    </View>

                    <View className='h-10 w-[70%] mx-auto bg-black/5 mt-12 z-[0] rounded-full' />
                    <HapticPressable onPress={handleCopyAddress} className="mx-10 bg-white rounded-[28px] -mt-8 p-8 items-center border border-black/5">
                        <View className="bg-white rounded-full relative w-full">
                            {qrCode}
                        </View>
                        <Typography weight="500" className="text-black/30 text-sm text-center mt-5 leading-4 max-w-[198px] mx-auto">
                            {walletAddress}
                        </Typography>

                    </HapticPressable>

                    <View className="flex-1 h-full" />

                    <View className="mx-6 mb-7 flex-row items-center justify-between">
                        <View className="flex-row items-center px-2">
                            <MaterialCommunityIcons name="shield-half-full" size={28} color="#3B82F6" />
                            <View className="ml-3">
                                <Typography weight="600" className="text-base">Receive with <Typography>Hide My Wallet</Typography></Typography>
                                <View className="flex-row items-center">
                                    <Typography weight="600" className="text-black/30 text-sm mr-1">How it works?</Typography>
                                    <Ionicons name="information-circle-outline" size={16} color="#0000004D" />
                                </View>
                            </View>
                        </View>
                        <View className="w-16 h-7 bg-black/10 rounded-full justify-center px-0.5">
                            <View className="w-10 h-6 bg-white rounded-full shadow-sm" />
                        </View>
                    </View>

                    {/* Copy Address Button */}
                    <View className="mx-6 mb-8">
                        <HapticPressable
                            className="bg-black/5 py-4 rounded-full items-center border-none"
                            onPress={handleCopyAddress}
                        >
                            <Typography weight="700" className="text-black text-base">Copy address</Typography>
                        </HapticPressable>
                    </View>
                </BottomSheetView>
            </BottomSheetModal>
        );
    }
);
